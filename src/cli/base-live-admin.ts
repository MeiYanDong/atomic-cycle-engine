import console from 'node:console'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getContractAddress,
  isAddressEqual,
  keccak256,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from 'viem'

import { appendEvidence } from '../evidence/jsonl-store.js'
import { BASE_GAS_PRICE_ORACLE, BASE_WETH } from '../live/base-v2-v3/addresses.js'
import { BASE_EXECUTOR_ABI, ERC20_ABI, GAS_PRICE_ORACLE_ABI } from '../live/base-v2-v3/abi.js'
import { createBaseReadClient, type BaseReadClient } from '../live/base-v2-v3/client.js'
import { loadSignerAccount } from '../live/base-v2-v3/credential.js'
import { broadcastRawTransaction } from '../live/base-v2-v3/execution.js'
import { acquireLiveFence } from '../live/base-v2-v3/ledger.js'
import { loadBaseLivePolicy, type BaseLivePolicy } from '../live/base-v2-v3/policy.js'
import { BASE_CANARY_TOKENS } from '../live/base-v2-v3/tokens.js'

interface ExecutorArtifact {
  readonly bytecode: Hex
  readonly deployedBytecode: Hex
  readonly immutableReferences: Readonly<
    Record<string, readonly Readonly<{ start: number; length: number }>[]>
  >
  readonly sourceSha256: string
  readonly compiler: string
}

interface SentAdminTransaction {
  readonly hash: Hex
  readonly nonce: number
  readonly gasLimit: bigint
  readonly maxFeePerGas: bigint
  readonly l1FeeEstimate: bigint
  readonly operatorFeeEstimate: bigint
  readonly receiptBlock: bigint
  readonly contractAddress: Address | null
}

function isImmutableReferences(value: unknown): value is ExecutorArtifact['immutableReferences'] {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every(
    (references) =>
      Array.isArray(references) &&
      references.every(
        (reference: unknown) =>
          typeof reference === 'object' &&
          reference !== null &&
          Number.isSafeInteger((reference as { start?: unknown }).start) &&
          Number.isSafeInteger((reference as { length?: unknown }).length),
      ),
  )
}

function isArtifact(value: unknown): value is ExecutorArtifact {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.bytecode === 'string' &&
    /^0x[0-9a-fA-F]+$/.test(candidate.bytecode) &&
    typeof candidate.deployedBytecode === 'string' &&
    /^0x[0-9a-fA-F]+$/.test(candidate.deployedBytecode) &&
    isImmutableReferences(candidate.immutableReferences) &&
    typeof candidate.sourceSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.sourceSha256) &&
    typeof candidate.compiler === 'string'
  )
}

function normalizedRuntime(
  bytecode: Hex,
  immutableReferences: ExecutorArtifact['immutableReferences'],
): string {
  const bytes = bytecode.slice(2).toLowerCase().split('')
  for (const references of Object.values(immutableReferences)) {
    for (const reference of references) {
      if (
        !Number.isSafeInteger(reference.start) ||
        !Number.isSafeInteger(reference.length) ||
        reference.start < 0 ||
        reference.length <= 0 ||
        (reference.start + reference.length) * 2 > bytes.length
      ) {
        throw new Error('compiled immutable reference is invalid')
      }
      bytes.fill('0', reference.start * 2, (reference.start + reference.length) * 2)
    }
  }
  return bytes.join('')
}

function runtimeMatchesArtifact(code: Hex, artifact: ExecutorArtifact): boolean {
  if (code.length !== artifact.deployedBytecode.length) return false
  return (
    normalizedRuntime(code, artifact.immutableReferences) ===
    normalizedRuntime(artifact.deployedBytecode, artifact.immutableReferences)
  )
}

async function readArtifact(): Promise<ExecutorArtifact> {
  const artifactPath = path.resolve('artifacts/BaseV2V3CycleExecutor.json')
  const parsed: unknown = JSON.parse(await readFile(artifactPath, 'utf8'))
  if (!isArtifact(parsed)) throw new Error('compiled executor artifact is invalid')
  return parsed
}

function gasWithBuffer(estimate: bigint, multiplierBps: bigint): bigint {
  return (estimate * multiplierBps + 9_999n) / 10_000n
}

async function sendAdminTransaction(input: {
  readonly label: string
  readonly client: BaseReadClient
  readonly account: PrivateKeyAccount
  readonly policy: BaseLivePolicy
  readonly data: Hex
  readonly to?: Address
  readonly value: bigint
  readonly requireLiveAuthorization?: boolean
  readonly preserveReserve?: boolean
}): Promise<SentAdminTransaction> {
  if (
    input.requireLiveAuthorization !== false &&
    (!input.policy.liveArm || input.policy.authorizationId === null)
  ) {
    throw new Error('admin write requires an explicit armed authorization scope')
  }
  const fee = await input.client.estimateFeesPerGas({ type: 'eip1559' })
  if (fee.maxFeePerGas > input.policy.maximumFeePerGas) {
    throw new Error('current Base max fee exceeds the policy cap')
  }
  const gasEstimate = await input.client.estimateGas({
    account: input.account.address,
    ...(input.to === undefined ? {} : { to: input.to }),
    data: input.data,
    value: input.value,
  })
  const gasLimit = gasWithBuffer(gasEstimate, input.policy.gasLimitMultiplierBps)
  const nonce = await input.client.getTransactionCount({
    address: input.account.address,
    blockTag: 'pending',
  })
  const serialized = await input.account.signTransaction({
    chainId: 8453,
    type: 'eip1559',
    ...(input.to === undefined ? {} : { to: input.to }),
    data: input.data,
    value: input.value,
    nonce,
    gas: gasLimit,
    maxFeePerGas: fee.maxFeePerGas,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
  })
  const hash = keccak256(serialized)
  const l1FeeEstimate = await input.client.readContract({
    address: BASE_GAS_PRICE_ORACLE,
    abi: GAS_PRICE_ORACLE_ABI,
    functionName: 'getL1Fee',
    args: [serialized],
  })
  const operatorFeeEstimate = await input.client.readContract({
    address: BASE_GAS_PRICE_ORACLE,
    abi: GAS_PRICE_ORACLE_ABI,
    functionName: 'getOperatorFee',
    args: [gasLimit],
  })
  const maximumCost =
    input.value +
    gasLimit * fee.maxFeePerGas +
    gasWithBuffer(l1FeeEstimate, input.policy.l1FeeMultiplierBps) +
    gasWithBuffer(operatorFeeEstimate, input.policy.operatorFeeMultiplierBps)
  const balance = await input.client.getBalance({ address: input.account.address })
  const requiredBalance =
    maximumCost + (input.preserveReserve === false ? 0n : input.policy.reserveFloor)
  if (balance < requiredBalance) {
    throw new Error('admin transaction would violate the ETH reserve floor')
  }
  const adminLedger = path.join(input.policy.stateDirectory, 'admin.jsonl')
  await appendEvidence(adminLedger, {
    schemaVersion: 1,
    stage: 'ADMIN_PLAN',
    label: input.label,
    recordedAt: new Date().toISOString(),
    transactionHash: hash,
    nonce,
    value: input.value,
    gasLimit,
    maxFeePerGas: fee.maxFeePerGas,
    l1FeeEstimate,
    operatorFeeEstimate,
    approvalRef: input.policy.authorizationId,
  })
  const endpoints = await broadcastRawTransaction(input.policy.broadcastRpcUrls, serialized, hash)
  await appendEvidence(adminLedger, {
    schemaVersion: 1,
    stage: 'ADMIN_BROADCAST',
    label: input.label,
    recordedAt: new Date().toISOString(),
    transactionHash: hash,
    nonce,
    endpoints,
  })
  let receipt
  try {
    receipt = await input.client.waitForTransactionReceipt({
      hash,
      confirmations: 2,
      timeout: 60_000,
    })
  } catch (error) {
    await appendEvidence(adminLedger, {
      schemaVersion: 1,
      stage: 'ADMIN_UNKNOWN',
      label: input.label,
      recordedAt: new Date().toISOString(),
      transactionHash: hash,
      nonce,
      errorClass: error instanceof Error ? error.name : 'unknown',
    })
    throw new Error(`${input.label} receipt remains unknown; do not retry automatically`, {
      cause: error,
    })
  }
  await appendEvidence(adminLedger, {
    schemaVersion: 1,
    stage: 'ADMIN_RECEIPT',
    label: input.label,
    recordedAt: new Date().toISOString(),
    transactionHash: hash,
    nonce,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    contractAddress: receipt.contractAddress ?? null,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
  })
  if (receipt.status !== 'success') throw new Error(`${input.label} reverted on Base`)
  return {
    hash,
    nonce,
    gasLimit,
    maxFeePerGas: fee.maxFeePerGas,
    l1FeeEstimate,
    operatorFeeEstimate,
    receiptBlock: receipt.blockNumber,
    contractAddress: receipt.contractAddress ?? null,
  }
}

async function executorStatus(
  client: BaseReadClient,
  account: PrivateKeyAccount,
  policy: BaseLivePolicy,
) {
  const signerEth = await client.getBalance({ address: account.address })
  if (policy.executorAddress === null) {
    return {
      signer: account.address,
      signerEth: formatEther(signerEth),
      executor: null,
      runtimeArm: policy.liveArm,
      state: 'NOT_DEPLOYED_OR_NOT_CONFIGURED',
    }
  }
  const executor = policy.executorAddress
  const code = await client.getBytecode({ address: executor })
  if (code === undefined || code === '0x') {
    return {
      signer: account.address,
      signerEth: formatEther(signerEth),
      executor,
      runtimeArm: policy.liveArm,
      state: 'NO_CODE',
    }
  }
  const [operator, armed, maximumAmountIn, minimumGrossProfit, wethBalance, approvals] =
    await Promise.all([
      client.readContract({ address: executor, abi: BASE_EXECUTOR_ABI, functionName: 'operator' }),
      client.readContract({ address: executor, abi: BASE_EXECUTOR_ABI, functionName: 'armed' }),
      client.readContract({
        address: executor,
        abi: BASE_EXECUTOR_ABI,
        functionName: 'maximumAmountIn',
      }),
      client.readContract({
        address: executor,
        abi: BASE_EXECUTOR_ABI,
        functionName: 'minimumGrossProfit',
      }),
      client.readContract({
        address: BASE_WETH,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [executor],
      }),
      Promise.all(
        BASE_CANARY_TOKENS.map((token) =>
          client.readContract({
            address: executor,
            abi: BASE_EXECUTOR_ABI,
            functionName: 'approvedToken',
            args: [token.address],
          }),
        ),
      ),
    ])
  return {
    signer: account.address,
    signerEth: formatEther(signerEth),
    executor,
    operator,
    operatorMatches: isAddressEqual(operator, account.address),
    contractArmed: armed,
    runtimeArm: policy.liveArm,
    maximumAmountInWeth: formatEther(maximumAmountIn),
    minimumContractProfitWeth: formatEther(minimumGrossProfit),
    executorWeth: formatEther(wethBalance),
    approvedTokens: BASE_CANARY_TOKENS.filter((_token, index) => approvals[index]).map(
      (token) => token.symbol,
    ),
    state:
      armed && policy.liveArm
        ? 'LIVE_ARMED'
        : armed
          ? 'CONTRACT_ARMED_RUNTIME_BLOCKED'
          : 'DISARMED',
  }
}

async function deploy(
  client: BaseReadClient,
  account: PrivateKeyAccount,
  policy: BaseLivePolicy,
): Promise<void> {
  if (policy.executorAddress !== null) throw new Error('executor is already configured')
  const artifact = await readArtifact()
  const data = encodeDeployData({
    abi: BASE_EXECUTOR_ABI,
    bytecode: artifact.bytecode,
    args: [
      account.address,
      policy.maximumAmountIn,
      policy.minimumContractProfit,
      BASE_CANARY_TOKENS.map((token) => token.address),
    ],
  })
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' })
  const expectedAddress = getContractAddress({ from: account.address, nonce: BigInt(nonce) })
  const sent = await sendAdminTransaction({
    label: 'DEPLOY_AND_SEED',
    client,
    account,
    policy,
    data,
    value: policy.maximumAmountIn,
  })
  if (sent.contractAddress === null || !isAddressEqual(sent.contractAddress, expectedAddress)) {
    throw new Error('deployment receipt address does not match the precommitted address')
  }
  const deployedCode = await client.getBytecode({ address: expectedAddress })
  if (deployedCode === undefined || !runtimeMatchesArtifact(deployedCode, artifact)) {
    throw new Error('deployed runtime bytecode does not match the compiled artifact')
  }
  const deployedPolicy = { ...policy, executorAddress: expectedAddress }
  const status = await executorStatus(client, account, deployedPolicy)
  if (
    status.state !== 'DISARMED' ||
    status.operatorMatches !== true ||
    status.executorWeth !== formatEther(policy.maximumAmountIn) ||
    status.approvedTokens.length !== BASE_CANARY_TOKENS.length
  ) {
    throw new Error('deployed executor readback failed')
  }
  console.log(
    JSON.stringify(
      {
        status: 'DEPLOYED_DISARMED',
        executor: expectedAddress,
        transactionHash: sent.hash,
        sourceSha256: artifact.sourceSha256,
        compiler: artifact.compiler,
        runtimeCodeHash: keccak256(deployedCode),
        principalWeth: formatEther(policy.maximumAmountIn),
        next: 'Set BASE_EXECUTOR_ADDRESS to this address, verify status, then run arm.',
      },
      null,
      2,
    ),
  )
}

async function setArm(
  client: BaseReadClient,
  account: PrivateKeyAccount,
  policy: BaseLivePolicy,
  nextArmed: boolean,
): Promise<void> {
  if (policy.executorAddress === null) throw new Error('executor address is not configured')
  if (nextArmed && !policy.liveArm) throw new Error('runtime policy is not armed')
  const data = encodeFunctionData({
    abi: BASE_EXECUTOR_ABI,
    functionName: 'setArmed',
    args: [nextArmed],
  })
  const sent = await sendAdminTransaction({
    label: nextArmed ? 'ARM' : 'DISARM',
    client,
    account,
    policy,
    to: policy.executorAddress,
    data,
    value: 0n,
    requireLiveAuthorization: nextArmed,
    preserveReserve: nextArmed,
  })
  const status = await executorStatus(client, account, {
    ...policy,
    liveArm: nextArmed,
  })
  if (status.contractArmed !== nextArmed) throw new Error('arm state readback mismatch')
  console.log(
    JSON.stringify(
      {
        status: nextArmed ? 'LIVE_ARMED' : 'DISARMED',
        executor: policy.executorAddress,
        transactionHash: sent.hash,
        blockNumber: sent.receiptBlock.toString(),
      },
      null,
      2,
    ),
  )
}

const command = process.argv[2] ?? 'status'
const policy = loadBaseLivePolicy(process.env)
const client = createBaseReadClient(process.env.BASE_READ_RPC_URL)
const account = await loadSignerAccount({
  ...(process.env.CREDENTIALS_DIRECTORY === undefined
    ? {}
    : { credentialsDirectory: process.env.CREDENTIALS_DIRECTORY }),
  ...(process.env.BASE_SIGNER_CREDENTIAL_FILE === undefined
    ? {}
    : { explicitCredentialFile: process.env.BASE_SIGNER_CREDENTIAL_FILE }),
})

if (command === 'wallet' || command === 'status') {
  console.log(JSON.stringify(await executorStatus(client, account, policy), null, 2))
} else {
  const fence = await acquireLiveFence(policy.stateDirectory)
  try {
    if (command === 'deploy') {
      await deploy(client, account, policy)
    } else if (command === 'arm') {
      await setArm(client, account, policy, true)
    } else if (command === 'disarm') {
      await setArm(client, account, policy, false)
    } else {
      throw new Error(`unknown base live admin command: ${command}`)
    }
  } finally {
    await fence.release()
  }
}
