import console from 'node:console'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  getContractAddress,
  isAddressEqual,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from 'viem'

import { appendEvidence } from '../evidence/jsonl-store.js'
import { BASE_GAS_PRICE_ORACLE, BASE_WETH } from '../live/base-v2-v3/addresses.js'
import {
  BASE_EXECUTOR_ABI,
  ERC20_ABI,
  GAS_PRICE_ORACLE_ABI,
  LEGACY_BASE_EXECUTOR_ADMIN_ABI,
} from '../live/base-v2-v3/abi.js'
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

const EXPECTED_EXECUTOR_VERSION = keccak256(toHex('BASE_MULTI_VENUE_V1'))

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
  const [version, operator, armed, maximumAmountIn, minimumGrossProfit, wethBalance, approvals] =
    await Promise.all([
      client.readContract({
        address: executor,
        abi: BASE_EXECUTOR_ABI,
        functionName: 'EXECUTOR_VERSION',
      }),
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
    version,
    versionMatches: version === EXPECTED_EXECUTOR_VERSION,
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
      version !== EXPECTED_EXECUTOR_VERSION
        ? 'UNSUPPORTED_EXECUTOR_VERSION'
        : armed && policy.liveArm
          ? 'LIVE_ARMED'
          : armed
            ? 'CONTRACT_ARMED_RUNTIME_BLOCKED'
            : 'DISARMED',
  }
}

async function deployExecutor(
  client: BaseReadClient,
  account: PrivateKeyAccount,
  policy: BaseLivePolicy,
  seedPrincipal: boolean,
): Promise<void> {
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
    label: seedPrincipal ? 'DEPLOY_AND_SEED' : 'DEPLOY_NEXT_DISARMED',
    client,
    account,
    policy,
    data,
    value: seedPrincipal ? policy.maximumAmountIn : 0n,
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
    status.versionMatches !== true ||
    status.operatorMatches !== true ||
    status.executorWeth !== formatEther(seedPrincipal ? policy.maximumAmountIn : 0n) ||
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
        principalWeth: formatEther(seedPrincipal ? policy.maximumAmountIn : 0n),
        next: seedPrincipal
          ? 'Set BASE_EXECUTOR_ADDRESS to this address, verify status, then run arm.'
          : 'Run migrate <executor> while the current watcher is stopped and its ledger is resolved.',
      },
      null,
      2,
    ),
  )
}

async function migratePrincipal(
  client: BaseReadClient,
  account: PrivateKeyAccount,
  policy: BaseLivePolicy,
  destinationRaw: string | undefined,
): Promise<void> {
  if (policy.executorAddress === null) throw new Error('current executor address is not configured')
  if (destinationRaw === undefined) throw new Error('migrate requires the new executor address')
  const source = policy.executorAddress
  const destination = getAddress(destinationRaw)
  if (isAddressEqual(source, destination)) throw new Error('source and destination executors match')

  const destinationPolicy = { ...policy, executorAddress: destination }
  const destinationStatus = await executorStatus(client, account, destinationPolicy)
  if (
    destinationStatus.versionMatches !== true ||
    destinationStatus.operatorMatches !== true ||
    destinationStatus.maximumAmountInWeth !== formatEther(policy.maximumAmountIn) ||
    destinationStatus.minimumContractProfitWeth !== formatEther(policy.minimumContractProfit) ||
    destinationStatus.approvedTokens.length !== BASE_CANARY_TOKENS.length
  ) {
    throw new Error('destination executor policy readback failed')
  }

  const [sourceOperator, sourceArmed, sourceBalance, destinationBalanceBefore] = await Promise.all([
    client.readContract({
      address: source,
      abi: LEGACY_BASE_EXECUTOR_ADMIN_ABI,
      functionName: 'operator',
    }),
    client.readContract({
      address: source,
      abi: LEGACY_BASE_EXECUTOR_ADMIN_ABI,
      functionName: 'armed',
    }),
    client.readContract({
      address: BASE_WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [source],
    }),
    client.readContract({
      address: BASE_WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [destination],
    }),
  ])
  if (!isAddressEqual(sourceOperator, account.address)) {
    throw new Error('signer is not the source executor operator')
  }
  if (destinationStatus.contractArmed === true && sourceBalance > 0n) {
    throw new Error('destination executor must be disarmed before principal migration')
  }
  if (sourceBalance === 0n && destinationBalanceBefore < policy.maximumAmountIn) {
    throw new Error('no migratable source principal and destination is underfunded')
  }

  const transactionHashes: Hex[] = []
  if (sourceArmed) {
    const sent = await sendAdminTransaction({
      label: 'MIGRATE_DISARM_SOURCE',
      client,
      account,
      policy,
      to: source,
      data: encodeFunctionData({
        abi: LEGACY_BASE_EXECUTOR_ADMIN_ABI,
        functionName: 'setArmed',
        args: [false],
      }),
      value: 0n,
    })
    transactionHashes.push(sent.hash)
    const armedAfter = await client.readContract({
      address: source,
      abi: LEGACY_BASE_EXECUTOR_ADMIN_ABI,
      functionName: 'armed',
    })
    if (armedAfter) throw new Error('source executor disarm readback failed')
  }

  if (sourceBalance > 0n) {
    const sent = await sendAdminTransaction({
      label: 'MIGRATE_PRINCIPAL',
      client,
      account,
      policy,
      to: source,
      data: encodeFunctionData({
        abi: LEGACY_BASE_EXECUTOR_ADMIN_ABI,
        functionName: 'withdraw',
        args: [BASE_WETH, sourceBalance, destination],
      }),
      value: 0n,
    })
    transactionHashes.push(sent.hash)
  }

  const [sourceBalanceAfter, destinationBalanceAfter] = await Promise.all([
    client.readContract({
      address: BASE_WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [source],
    }),
    client.readContract({
      address: BASE_WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [destination],
    }),
  ])
  if (
    sourceBalanceAfter !== 0n ||
    destinationBalanceAfter !== destinationBalanceBefore + sourceBalance ||
    destinationBalanceAfter < policy.maximumAmountIn
  ) {
    throw new Error('principal migration balance readback failed')
  }

  if (destinationStatus.contractArmed !== true) {
    const sent = await sendAdminTransaction({
      label: 'MIGRATE_ARM_DESTINATION',
      client,
      account,
      policy: destinationPolicy,
      to: destination,
      data: encodeFunctionData({
        abi: BASE_EXECUTOR_ABI,
        functionName: 'setArmed',
        args: [true],
      }),
      value: 0n,
    })
    transactionHashes.push(sent.hash)
  }

  const finalStatus = await executorStatus(client, account, destinationPolicy)
  if (
    finalStatus.state !== 'LIVE_ARMED' ||
    finalStatus.executorWeth !== formatEther(destinationBalanceAfter)
  ) {
    throw new Error('destination executor final readback failed')
  }
  console.log(
    JSON.stringify(
      {
        status: 'MIGRATED_AND_LIVE_ARMED',
        source,
        destination,
        migratedWeth: formatEther(sourceBalance),
        destinationWeth: formatEther(destinationBalanceAfter),
        transactionHashes,
        next: 'Persist BASE_EXECUTOR_ADDRESS, start the watcher, and verify a fresh heartbeat.',
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
      if (policy.executorAddress !== null) throw new Error('executor is already configured')
      await deployExecutor(client, account, policy, true)
    } else if (command === 'deploy-next') {
      await deployExecutor(client, account, policy, false)
    } else if (command === 'migrate') {
      await migratePrincipal(client, account, policy, process.argv[3])
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
