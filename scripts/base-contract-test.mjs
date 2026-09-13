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
  getAddress,
  http,
  keccak256,
  toHex,
} from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rpcPort = Number(process.env.BASE_CYCLE_TEST_RPC_PORT || 18_549)
const rpcUrl = `http://127.0.0.1:${rpcPort}`
const chain = defineChain({
  id: 8453,
  name: 'Base cycle deterministic test',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})

const WETH = getAddress('0x4200000000000000000000000000000000000006')
const V2_FACTORY = getAddress('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6')
const V3_FACTORY = getAddress('0x33128a8fC17869897dcE68Ed026d694621f6FDfD')
const PANCAKE_V3_FACTORY = getAddress('0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865')
const TOKEN = getAddress('0x1000000000000000000000000000000000000001')
const V2_PAIR = getAddress('0x2000000000000000000000000000000000000002')
const V3_POOL = getAddress('0x3000000000000000000000000000000000000003')
const PANCAKE_V3_POOL = getAddress('0x4000000000000000000000000000000000000004')

function compile() {
  const sources = {
    'BaseV2V3CycleExecutor.sol': {
      content: fs.readFileSync(path.join(root, 'contracts', 'BaseV2V3CycleExecutor.sol'), 'utf8'),
    },
    'BaseV2V3TestRuntime.sol': {
      content: fs.readFileSync(
        path.join(root, 'test', 'contracts', 'BaseV2V3TestRuntime.sol'),
        'utf8',
      ),
    },
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((item) => item.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  return output.contracts
}

async function waitForRpc(child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Hardhat node exited before readiness: ${child.exitCode}`)
    }
    try {
      const response = await globalThis.fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      })
      if (response.ok) return
    } catch {
      // The node is still starting.
    }
    await delay(50)
  }
  throw new Error('Hardhat node did not become ready')
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
  const contracts = compile()
  const executorArtifact = contracts['BaseV2V3CycleExecutor.sol'].BaseV2V3CycleExecutor
  const runtime = contracts['BaseV2V3TestRuntime.sol']
  const hardhat = path.join(root, 'node_modules', '.bin', 'hardhat')
  const diagnostics = []
  const child = spawn(
    hardhat,
    ['node', '--network', 'hardhatMainnet', '--hostname', '127.0.0.1', '--port', String(rpcPort)],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.on('data', (chunk) => diagnostics.push(chunk.toString()))
  child.stderr.on('data', (chunk) => diagnostics.push(chunk.toString()))

  try {
    await waitForRpc(child)
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    const accounts = await publicClient.request({ method: 'eth_accounts' })
    const operator = getAddress(accounts[0])
    const other = getAddress(accounts[1])
    const walletClient = createWalletClient({ account: operator, chain, transport: http(rpcUrl) })

    async function installCode(address, artifact) {
      await publicClient.request({
        method: 'hardhat_setCode',
        params: [address, `0x${artifact.evm.deployedBytecode.object}`],
      })
    }

    const tokenArtifact = runtime.MockBaseCycleToken
    const v2FactoryArtifact = runtime.MockBaseCycleV2Factory
    const v3FactoryArtifact = runtime.MockBaseCycleV3Factory
    const v2PairArtifact = runtime.MockBaseCycleV2Pair
    const v3PoolArtifact = runtime.MockBaseCycleV3Pool
    const pancakeV3PoolArtifact = runtime.MockBaseCyclePancakeV3Pool
    for (const address of [WETH, TOKEN]) await installCode(address, tokenArtifact)
    await installCode(V2_FACTORY, v2FactoryArtifact)
    await installCode(V3_FACTORY, v3FactoryArtifact)
    await installCode(PANCAKE_V3_FACTORY, v3FactoryArtifact)
    await installCode(V2_PAIR, v2PairArtifact)
    await installCode(V3_POOL, v3PoolArtifact)
    await installCode(PANCAKE_V3_POOL, pancakeV3PoolArtifact)

    async function write(address, abi, functionName, args) {
      const hash = await walletClient.writeContract({ address, abi, functionName, args })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error(`setup transaction ${functionName} failed`)
      return receipt
    }

    await write(V2_FACTORY, v2FactoryArtifact.abi, 'setPair', [WETH, TOKEN, V2_PAIR])
    await write(V3_FACTORY, v3FactoryArtifact.abi, 'setPool', [WETH, TOKEN, 500, V3_POOL])
    await write(PANCAKE_V3_FACTORY, v3FactoryArtifact.abi, 'setPool', [
      WETH,
      TOKEN,
      500,
      PANCAKE_V3_POOL,
    ])
    await write(V2_PAIR, v2PairArtifact.abi, 'configure', [
      TOKEN,
      WETH,
      1_000n * 10n ** 18n,
      1_000n * 10n ** 18n,
    ])
    await write(V3_POOL, v3PoolArtifact.abi, 'configure', [TOKEN, WETH, WETH, 102n, 100n])
    await write(PANCAKE_V3_POOL, pancakeV3PoolArtifact.abi, 'configure', [
      TOKEN,
      WETH,
      WETH,
      103n,
      100n,
    ])

    const seededDeploymentHash = await walletClient.deployContract({
      abi: executorArtifact.abi,
      bytecode: `0x${executorArtifact.evm.bytecode.object}`,
      args: [operator, 3n * 10n ** 18n, 1_000_000_000_000n, [TOKEN]],
      value: 3n * 10n ** 18n,
    })
    const seededDeployment = await publicClient.waitForTransactionReceipt({
      hash: seededDeploymentHash,
    })
    if (seededDeployment.status !== 'success' || !seededDeployment.contractAddress) {
      throw new Error('seeded deterministic executor deployment failed')
    }
    const seededExecutor = getAddress(seededDeployment.contractAddress)
    const [seededBalance, seededApproval] = await Promise.all([
      publicClient.readContract({
        address: WETH,
        abi: tokenArtifact.abi,
        functionName: 'balanceOf',
        args: [seededExecutor],
      }),
      publicClient.readContract({
        address: seededExecutor,
        abi: executorArtifact.abi,
        functionName: 'approvedToken',
        args: [TOKEN],
      }),
    ])
    if (seededBalance !== 3n * 10n ** 18n || seededApproval !== true) {
      throw new Error('constructor did not atomically seed WETH and token approval')
    }

    const deploymentHash = await walletClient.deployContract({
      abi: executorArtifact.abi,
      bytecode: `0x${executorArtifact.evm.bytecode.object}`,
      args: [operator, 10n * 10n ** 18n, 1_000_000_000_000n, []],
    })
    const deployment = await publicClient.waitForTransactionReceipt({ hash: deploymentHash })
    if (deployment.status !== 'success' || !deployment.contractAddress) {
      throw new Error('deterministic executor deployment failed')
    }
    const executor = getAddress(deployment.contractAddress)
    await write(WETH, tokenArtifact.abi, 'mint', [executor, 10n * 10n ** 18n])

    const v2FirstRoute = {
      intermediateToken: TOKEN,
      entryVenue: 0,
      entryFee: 0,
      exitVenue: 1,
      exitFee: 500,
    }
    const block = await publicClient.getBlock()
    const amountIn = 1n * 10n ** 18n
    const minProfit = 5n * 10n ** 15n
    const validDeadline = block.timestamp + 300n
    const validThroughBlock = block.number + 10n

    async function mustRevert(label, expectedName, signature, request) {
      try {
        await publicClient.simulateContract(request)
      } catch (error) {
        if (!containsExpectedError(error, expectedName, signature)) {
          throw new Error(`${label} reverted with the wrong selector; expected ${expectedName}`, {
            cause: error,
          })
        }
        return label
      }
      throw new Error(`${label} did not revert`)
    }

    const executeRequest = (args, account = operator) => ({
      account,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'execute',
      args,
    })

    const negativeChecks = []
    negativeChecks.push(
      await mustRevert(
        'not_armed',
        'NotArmed',
        'NotArmed()',
        executeRequest([v2FirstRoute, amountIn, minProfit, validDeadline, validThroughBlock]),
      ),
    )
    negativeChecks.push(
      await mustRevert('non_operator_arm', 'NotOperator', 'NotOperator()', {
        account: other,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'setArmed',
        args: [true],
      }),
    )
    await write(executor, executorArtifact.abi, 'setArmed', [true])
    negativeChecks.push(
      await mustRevert(
        'token_not_approved',
        'TokenNotApproved',
        'TokenNotApproved()',
        executeRequest([v2FirstRoute, amountIn, minProfit, validDeadline, validThroughBlock]),
      ),
    )
    await write(executor, executorArtifact.abi, 'setArmed', [false])
    await write(executor, executorArtifact.abi, 'setTokenApproval', [TOKEN, true])
    await write(executor, executorArtifact.abi, 'setArmed', [true])
    negativeChecks.push(
      await mustRevert(
        'non_operator_execute',
        'NotOperator',
        'NotOperator()',
        executeRequest(
          [v2FirstRoute, amountIn, minProfit, validDeadline, validThroughBlock],
          other,
        ),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'amount_above_cap',
        'InvalidAmount',
        'InvalidAmount()',
        executeRequest([
          v2FirstRoute,
          10n * 10n ** 18n + 1n,
          minProfit,
          validDeadline,
          validThroughBlock,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'profit_floor_below_contract_floor',
        'ProfitFloorTooLow',
        'ProfitFloorTooLow()',
        executeRequest([
          v2FirstRoute,
          amountIn,
          999_999_999_999n,
          validDeadline,
          validThroughBlock,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'expired',
        'Expired',
        'Expired()',
        executeRequest([
          v2FirstRoute,
          amountIn,
          minProfit,
          block.timestamp - 1n,
          validThroughBlock,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'stale_block',
        'StaleBlock',
        'StaleBlock()',
        executeRequest([v2FirstRoute, amountIn, minProfit, validDeadline, block.number - 1n]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'invalid_v3_fee',
        'InvalidRoute',
        'InvalidRoute()',
        executeRequest([
          {
            intermediateToken: TOKEN,
            entryVenue: 0,
            entryFee: 0,
            exitVenue: 1,
            exitFee: 250,
          },
          amountIn,
          minProfit,
          validDeadline,
          validThroughBlock,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert('forged_v3_callback', 'UnauthorizedCallback', 'UnauthorizedCallback()', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'uniswapV3SwapCallback',
        args: [amountIn, -amountIn, '0x'],
      }),
    )
    negativeChecks.push(
      await mustRevert(
        'forged_pancake_v3_callback',
        'UnauthorizedCallback',
        'UnauthorizedCallback()',
        {
          account: operator,
          address: executor,
          abi: executorArtifact.abi,
          functionName: 'pancakeV3SwapCallback',
          args: [amountIn, -amountIn, '0x'],
        },
      ),
    )
    negativeChecks.push(
      await mustRevert('withdraw_while_armed', 'MustDisarm', 'MustDisarm()', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'withdraw',
        args: [WETH, 1n, operator],
      }),
    )
    negativeChecks.push(
      await mustRevert('approve_token_while_armed', 'MustDisarm', 'MustDisarm()', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'setTokenApproval',
        args: [TOKEN, false],
      }),
    )

    const positiveSimulation = await publicClient.simulateContract(
      executeRequest([v2FirstRoute, amountIn, minProfit, validDeadline, validThroughBlock]),
    )
    const [firstAmountOut, firstProfit] = positiveSimulation.result
    if (firstAmountOut <= amountIn || firstProfit < minProfit) {
      throw new Error('v2-first simulation did not prove a positive bounded WETH delta')
    }
    const wethBefore = await publicClient.readContract({
      address: WETH,
      abi: tokenArtifact.abi,
      functionName: 'balanceOf',
      args: [executor],
    })
    const executionHash = await walletClient.writeContract(positiveSimulation.request)
    const execution = await publicClient.waitForTransactionReceipt({ hash: executionHash })
    const wethAfter = await publicClient.readContract({
      address: WETH,
      abi: tokenArtifact.abi,
      functionName: 'balanceOf',
      args: [executor],
    })
    if (execution.status !== 'success' || wethAfter - wethBefore !== firstProfit) {
      throw new Error('v2-first receipt and WETH balance delta did not reconcile')
    }

    await write(V3_POOL, v3PoolArtifact.abi, 'configure', [TOKEN, WETH, WETH, 98n, 100n])
    const reverseRoute = {
      intermediateToken: TOKEN,
      entryVenue: 1,
      entryFee: 500,
      exitVenue: 0,
      exitFee: 0,
    }
    const reverseSimulation = await publicClient.simulateContract(
      executeRequest([reverseRoute, amountIn, minProfit, validDeadline, validThroughBlock]),
    )
    const [reverseAmountOut, reverseProfit] = reverseSimulation.result
    if (reverseAmountOut <= amountIn || reverseProfit < minProfit) {
      throw new Error('v3-first simulation did not prove a positive bounded WETH delta')
    }

    await write(V3_POOL, v3PoolArtifact.abi, 'configure', [TOKEN, WETH, WETH, 102n, 100n])
    const crossV3Route = {
      intermediateToken: TOKEN,
      entryVenue: 1,
      entryFee: 500,
      exitVenue: 2,
      exitFee: 500,
    }
    const crossV3Simulation = await publicClient.simulateContract(
      executeRequest([crossV3Route, amountIn, minProfit, validDeadline, validThroughBlock]),
    )
    const [crossV3AmountOut, crossV3Profit] = crossV3Simulation.result
    if (crossV3AmountOut <= amountIn || crossV3Profit < minProfit) {
      throw new Error('cross-v3 simulation did not prove a positive bounded WETH delta')
    }

    await write(TOKEN, tokenArtifact.abi, 'configureFee', [100n])
    negativeChecks.push(
      await mustRevert(
        'fee_on_transfer_rejected',
        'NonStandardTokenBehavior',
        'NonStandardTokenBehavior()',
        executeRequest([v2FirstRoute, amountIn, minProfit, validDeadline, validThroughBlock]),
      ),
    )

    await write(executor, executorArtifact.abi, 'setArmed', [false])
    const withdrawSimulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'withdraw',
      args: [WETH, 1n, operator],
    })
    if (!withdrawSimulation.request) throw new Error('disarmed withdrawal was not simulatable')

    await write(TOKEN, tokenArtifact.abi, 'configureFee', [0n])
    const replacementDeploymentHash = await walletClient.deployContract({
      abi: executorArtifact.abi,
      bytecode: `0x${executorArtifact.evm.bytecode.object}`,
      args: [operator, 10n * 10n ** 18n, 1_000_000_000_000n, [TOKEN]],
    })
    const replacementDeployment = await publicClient.waitForTransactionReceipt({
      hash: replacementDeploymentHash,
    })
    if (replacementDeployment.status !== 'success' || !replacementDeployment.contractAddress) {
      throw new Error('replacement executor deployment failed')
    }
    const replacement = getAddress(replacementDeployment.contractAddress)
    const sourceBalanceBeforeMigration = await publicClient.readContract({
      address: WETH,
      abi: tokenArtifact.abi,
      functionName: 'balanceOf',
      args: [executor],
    })
    await write(executor, executorArtifact.abi, 'withdraw', [
      WETH,
      sourceBalanceBeforeMigration,
      replacement,
    ])
    await write(replacement, executorArtifact.abi, 'setArmed', [true])
    const [sourceBalanceAfterMigration, replacementBalance, replacementArmed] = await Promise.all([
      publicClient.readContract({
        address: WETH,
        abi: tokenArtifact.abi,
        functionName: 'balanceOf',
        args: [executor],
      }),
      publicClient.readContract({
        address: WETH,
        abi: tokenArtifact.abi,
        functionName: 'balanceOf',
        args: [replacement],
      }),
      publicClient.readContract({
        address: replacement,
        abi: executorArtifact.abi,
        functionName: 'armed',
      }),
    ])
    if (
      sourceBalanceAfterMigration !== 0n ||
      replacementBalance !== sourceBalanceBeforeMigration ||
      replacementArmed !== true
    ) {
      throw new Error('replacement executor migration readback failed')
    }

    const deployedBytes = executorArtifact.evm.deployedBytecode.object.length / 2
    if (deployedBytes >= 24_576)
      throw new Error(`runtime bytecode exceeds EIP-170: ${deployedBytes}`)

    console.log(
      JSON.stringify(
        {
          status: 'ok',
          chainId: await publicClient.getChainId(),
          contract: 'BaseV2V3CycleExecutor',
          runtimeBytes: deployedBytes,
          positivePaths: [
            { direction: 'v2_to_v3', amountOut: firstAmountOut, grossProfit: firstProfit },
            { direction: 'v3_to_v2', amountOut: reverseAmountOut, grossProfit: reverseProfit },
            {
              direction: 'uniswap_v3_to_pancakeswap_v3',
              amountOut: crossV3AmountOut,
              grossProfit: crossV3Profit,
            },
          ],
          receiptReconciled: true,
          migrationReconciled: true,
          negativeChecks,
        },
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
        2,
      ),
    )
  } catch (error) {
    const tail = diagnostics.join('').slice(-4_000)
    if (tail) console.error(tail)
    throw error
  } finally {
    child.kill('SIGTERM')
  }
}

await main()
