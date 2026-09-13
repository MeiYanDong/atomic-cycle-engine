import { spawn } from 'node:child_process'
import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import solc from 'solc'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  keccak256,
  toHex,
} from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rpcPort = Number(process.env.BASE_CYCLE_FORK_TEST_PORT || 18_550)
const rpcUrl = `http://127.0.0.1:${rpcPort}`
const upstreamRpc = process.env.BASE_FORK_RPC_URL || 'https://mainnet.base.org'
const chain = defineChain({
  id: 8453,
  name: 'Base mainnet fork compatibility test',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})

const WETH = getAddress('0x4200000000000000000000000000000000000006')
const USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const MAXIMUM_AMOUNT_IN = 3_000_000_000_000_000n
const TEST_AMOUNT_IN = 250_000_000_000_000n

const WETH_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

function compileExecutor() {
  const input = {
    language: 'Solidity',
    sources: {
      'BaseV2V3CycleExecutor.sol': {
        content: fs.readFileSync(path.join(root, 'contracts', 'BaseV2V3CycleExecutor.sol'), 'utf8'),
      },
    },
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((item) => item.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  return output.contracts['BaseV2V3CycleExecutor.sol'].BaseV2V3CycleExecutor
}

async function waitForRpc(child) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Base fork exited before readiness with code ${String(child.exitCode)}`)
    }
    try {
      const response = await globalThis.fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: globalThis.AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {
      // Fork startup is still fetching the pinned Base state.
    }
    await delay(100)
  }
  throw new Error('Base fork did not become ready')
}

function containsExpectedError(error, name, signature) {
  const selector = keccak256(toHex(signature)).slice(0, 10).toLowerCase()
  const pending = [error]
  const visited = new Set()
  while (pending.length > 0) {
    const item = pending.shift()
    if (!item || visited.has(item)) continue
    if (typeof item === 'string') {
      if (item.includes(name) || item.toLowerCase().includes(selector)) return true
      continue
    }
    if (typeof item !== 'object') continue
    visited.add(item)
    if (item.errorName === name) return true
    for (const value of Object.values(item)) pending.push(value)
  }
  return false
}

async function main() {
  const artifact = compileExecutor()
  const hardhat = path.join(root, 'node_modules', '.bin', 'hardhat')
  const child = spawn(
    hardhat,
    [
      'node',
      '--chain-id',
      '8453',
      '--chain-type',
      'op',
      '--fork',
      upstreamRpc,
      '--hostname',
      '127.0.0.1',
      '--port',
      String(rpcPort),
    ],
    { cwd: root, env: { ...process.env, NO_COLOR: '1' }, stdio: 'ignore' },
  )

  try {
    await waitForRpc(child)
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    const accounts = await publicClient.request({ method: 'eth_accounts' })
    const operator = getAddress(accounts[0])
    const walletClient = createWalletClient({ account: operator, chain, transport: http(rpcUrl) })

    const deployHash = await walletClient.deployContract({
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
      args: [operator, MAXIMUM_AMOUNT_IN, 1n, [USDC]],
      value: MAXIMUM_AMOUNT_IN,
    })
    const deployment = await publicClient.waitForTransactionReceipt({ hash: deployHash })
    if (deployment.status !== 'success' || deployment.contractAddress === null) {
      throw new Error('executor did not deploy on the Base fork')
    }
    const executor = getAddress(deployment.contractAddress)
    const [operatorReadback, approved, wethBalance] = await Promise.all([
      publicClient.readContract({
        address: executor,
        abi: artifact.abi,
        functionName: 'operator',
      }),
      publicClient.readContract({
        address: executor,
        abi: artifact.abi,
        functionName: 'approvedToken',
        args: [USDC],
      }),
      publicClient.readContract({
        address: WETH,
        abi: WETH_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [executor],
      }),
    ])
    if (
      getAddress(operatorReadback) !== operator ||
      !approved ||
      wethBalance !== MAXIMUM_AMOUNT_IN
    ) {
      throw new Error('fork deployment readback did not match constructor commitments')
    }

    const armHash = await walletClient.writeContract({
      address: executor,
      abi: artifact.abi,
      functionName: 'setArmed',
      args: [true],
    })
    const armReceipt = await publicClient.waitForTransactionReceipt({ hash: armHash })
    if (armReceipt.status !== 'success') throw new Error('fork executor arm failed')

    const block = await publicClient.getBlock()
    const directions = []
    const routes = [
      {
        direction: 'uniswap_v2_to_uniswap_v3',
        route: { intermediateToken: USDC, entryVenue: 0, entryFee: 0, exitVenue: 1, exitFee: 500 },
      },
      {
        direction: 'uniswap_v3_to_uniswap_v2',
        route: { intermediateToken: USDC, entryVenue: 1, entryFee: 500, exitVenue: 0, exitFee: 0 },
      },
      {
        direction: 'uniswap_v3_to_pancakeswap_v3',
        route: {
          intermediateToken: USDC,
          entryVenue: 1,
          entryFee: 100,
          exitVenue: 2,
          exitFee: 100,
        },
      },
      {
        direction: 'pancakeswap_v3_to_uniswap_v3',
        route: {
          intermediateToken: USDC,
          entryVenue: 2,
          entryFee: 100,
          exitVenue: 1,
          exitFee: 100,
        },
      },
    ]
    for (const item of routes) {
      const { direction, route } = item
      const canonicalPools = await publicClient.readContract({
        address: executor,
        abi: artifact.abi,
        functionName: 'canonicalPools',
        args: [route],
      })
      try {
        const simulation = await publicClient.simulateContract({
          account: operator,
          address: executor,
          abi: artifact.abi,
          functionName: 'execute',
          args: [route, TEST_AMOUNT_IN, 1n, block.timestamp + 300n, block.number + 10n],
        })
        directions.push({
          direction,
          result: 'positive_on_fork',
          grossProfit: simulation.result[1].toString(),
          entryPool: canonicalPools[0],
          exitPool: canonicalPools[1],
        })
      } catch (error) {
        if (!containsExpectedError(error, 'ProfitTooLow', 'ProfitTooLow(uint256,uint256)')) {
          throw new Error(`${direction} failed before the on-chain profit gate`, { cause: error })
        }
        directions.push({
          direction,
          result: 'reached_profit_floor',
          entryPool: canonicalPools[0],
          exitPool: canonicalPools[1],
        })
      }
    }

    const disarmHash = await walletClient.writeContract({
      address: executor,
      abi: artifact.abi,
      functionName: 'setArmed',
      args: [false],
    })
    const disarmReceipt = await publicClient.waitForTransactionReceipt({ hash: disarmHash })
    const armed = await publicClient.readContract({
      address: executor,
      abi: artifact.abi,
      functionName: 'armed',
    })
    if (disarmReceipt.status !== 'success' || armed) throw new Error('fork disarm readback failed')

    console.log(
      JSON.stringify(
        {
          status: 'ok',
          chainId: await publicClient.getChainId(),
          forkBlock: block.number.toString(),
          seededWeth: formatEther(wethBalance),
          canonicalProtocolCompatibility: directions,
          writesConfinedToFork: true,
        },
        null,
        2,
      ),
    )
  } finally {
    child.kill('SIGTERM')
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

await main()
