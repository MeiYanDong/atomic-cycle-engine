import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type PrivateKeyAccount,
  type TransactionReceipt,
} from 'viem'

import { appendLiveLedger, type LiveEffectOutcome } from './ledger.js'
import { BASE_GAS_PRICE_ORACLE, BASE_WETH } from './addresses.js'
import { BASE_EXECUTOR_ABI, ERC20_ABI, GAS_PRICE_ORACLE_ABI } from './abi.js'
import type { BaseReadClient } from './client.js'
import type { BaseLivePolicy } from './policy.js'
import type { BaseCycleQuote } from './quote.js'

const BPS_DENOMINATOR = 10_000n
const EXPECTED_EXECUTOR_VERSION = keccak256(toHex('BASE_MULTI_VENUE_V1'))

export interface PreparedLivePlan {
  readonly attemptId: string
  readonly transactionHash: Hash
  readonly serialized: Hex
  readonly nonce: number
  readonly executor: Address
  readonly signer: Address
  readonly token: Address
  readonly tokenSymbol: string
  readonly entryPool: Address
  readonly exitPool: Address
  readonly routeHash: Hash
  readonly entryVenue: string
  readonly entryVenueCode: number
  readonly entryFee: number
  readonly exitVenue: string
  readonly exitVenueCode: number
  readonly exitFee: number
  readonly amountIn: bigint
  readonly minimumProfit: bigint
  readonly simulatedGrossProfit: bigint
  readonly quoteBlockNumber: bigint
  readonly quoteBlockHash: Hash
  readonly deadline: number
  readonly validThroughBlock: bigint
  readonly gasLimit: bigint
  readonly maxFeePerGas: bigint
  readonly maxPriorityFeePerGas: bigint
  readonly l1FeeEstimate: bigint
  readonly operatorFeeEstimate: bigint
  readonly maximumGasCost: bigint
  readonly executorWethBefore: bigint
  readonly signerEthBefore: bigint
}

export type ReceiptReconciliationPlan = Pick<
  PreparedLivePlan,
  | 'attemptId'
  | 'transactionHash'
  | 'nonce'
  | 'executor'
  | 'token'
  | 'entryPool'
  | 'exitPool'
  | 'routeHash'
  | 'entryVenueCode'
  | 'exitVenueCode'
  | 'amountIn'
  | 'minimumProfit'
  | 'executorWethBefore'
>

export interface ReconciledEffect {
  readonly outcome: LiveEffectOutcome
  readonly transactionHash: Hash
  readonly gasCost: bigint | null
  readonly grossProfit: bigint | null
  readonly economicNet: bigint | null
  readonly blockNumber: bigint | null
  readonly reason: string | null
}

function ceilMultiply(value: bigint, multiplierBps: bigint): bigint {
  return (value * multiplierBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
}

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right
}

async function validateExecutorState(
  client: BaseReadClient,
  policy: BaseLivePolicy,
  signer: Address,
  token: Address,
): Promise<Readonly<{ executor: Address; executorWethBalance: bigint; signerEthBalance: bigint }>> {
  if (!policy.liveArm || policy.executorAddress === null || policy.authorizationId === null) {
    throw new Error('live execution policy is not armed')
  }
  const executor = policy.executorAddress
  const code = await client.getBytecode({ address: executor })
  if (code === undefined || code === '0x') throw new Error('executor has no deployed code')

  const [
    version,
    operator,
    armed,
    approved,
    maximumAmountIn,
    minimumGrossProfit,
    executorWethBalance,
  ] = await Promise.all([
    client.readContract({
      address: executor,
      abi: BASE_EXECUTOR_ABI,
      functionName: 'EXECUTOR_VERSION',
    }),
    client.readContract({
      address: executor,
      abi: BASE_EXECUTOR_ABI,
      functionName: 'operator',
    }),
    client.readContract({ address: executor, abi: BASE_EXECUTOR_ABI, functionName: 'armed' }),
    client.readContract({
      address: executor,
      abi: BASE_EXECUTOR_ABI,
      functionName: 'approvedToken',
      args: [token],
    }),
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
  ])
  if (version !== EXPECTED_EXECUTOR_VERSION) throw new Error('executor version is not approved')
  if (!isAddressEqual(operator, signer)) throw new Error('signer is not the executor operator')
  if (!armed) throw new Error('executor is disarmed')
  if (!approved) throw new Error('candidate token is not approved on the executor')
  if (maximumAmountIn !== policy.maximumAmountIn) {
    throw new Error('on-chain and runtime principal caps differ')
  }
  if (minimumGrossProfit !== policy.minimumContractProfit) {
    throw new Error('on-chain and runtime contract profit floors differ')
  }
  const signerEthBalance = await client.getBalance({ address: signer })
  return { executor, executorWethBalance, signerEthBalance }
}

async function estimateL1Fee(client: BaseReadClient, serialized: Hex): Promise<bigint> {
  return client.readContract({
    address: BASE_GAS_PRICE_ORACLE,
    abi: GAS_PRICE_ORACLE_ABI,
    functionName: 'getL1Fee',
    args: [serialized],
  })
}

async function estimateOperatorFee(client: BaseReadClient, gasUsed: bigint): Promise<bigint> {
  return client.readContract({
    address: BASE_GAS_PRICE_ORACLE,
    abi: GAS_PRICE_ORACLE_ABI,
    functionName: 'getOperatorFee',
    args: [gasUsed],
  })
}

export async function prepareLivePlan(
  client: BaseReadClient,
  account: PrivateKeyAccount,
  policy: BaseLivePolicy,
  candidate: BaseCycleQuote,
): Promise<PreparedLivePlan> {
  if (
    candidate.disposition !== 'POSITIVE_GROSS' ||
    candidate.exactGrossProfit === null ||
    candidate.exactAmountOut === null
  ) {
    throw new Error('candidate is not a positive exact quote')
  }
  if (candidate.amountIn > policy.maximumAmountIn)
    throw new Error('candidate exceeds principal cap')
  const state = await validateExecutorState(
    client,
    policy,
    account.address,
    candidate.token.address,
  )
  if (state.executorWethBalance < candidate.amountIn)
    throw new Error('executor principal is insufficient')

  const quoteBlock = await client.getBlock({ blockHash: candidate.blockHash })
  if (quoteBlock.number !== candidate.blockNumber)
    throw new Error('quote block commitment mismatch')
  const deadlineValue = quoteBlock.timestamp + policy.deadlineSeconds
  if (deadlineValue > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('deadline exceeds safe integer')
  const deadline = Number(deadlineValue)
  const validThroughBlock = candidate.blockNumber + policy.validBlocks
  const route = {
    intermediateToken: candidate.token.address,
    entryVenue: candidate.entryVenueCode,
    entryFee: candidate.entryFee,
    exitVenue: candidate.exitVenueCode,
    exitFee: candidate.exitFee,
  } as const
  const routeHash = keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'intermediateToken', type: 'address' },
            { name: 'entryFee', type: 'uint24' },
            { name: 'exitFee', type: 'uint24' },
            { name: 'entryVenue', type: 'uint8' },
            { name: 'exitVenue', type: 'uint8' },
          ],
        },
      ],
      [route],
    ),
  )
  const feeEstimate = await client.estimateFeesPerGas({ type: 'eip1559' })
  if (feeEstimate.maxFeePerGas > policy.maximumFeePerGas) {
    throw new Error('current Base max fee exceeds the live policy cap')
  }
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' })
  let minimumProfit = policy.minimumContractProfit
  let gasLimit = 0n
  let l1FeeEstimate = 0n
  let operatorFeeEstimate = 0n
  let maximumGasCost = 0n
  let serialized: Hex

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const args = [route, candidate.amountIn, minimumProfit, deadline, validThroughBlock] as const
    const gasEstimate = await client.estimateContractGas({
      account: account.address,
      address: state.executor,
      abi: BASE_EXECUTOR_ABI,
      functionName: 'execute',
      args,
    })
    gasLimit = ceilMultiply(gasEstimate, policy.gasLimitMultiplierBps)
    const data = encodeFunctionData({
      abi: BASE_EXECUTOR_ABI,
      functionName: 'execute',
      args,
    })
    serialized = await account.signTransaction({
      chainId: 8453,
      type: 'eip1559',
      to: state.executor,
      data,
      value: 0n,
      nonce,
      gas: gasLimit,
      maxFeePerGas: feeEstimate.maxFeePerGas,
      maxPriorityFeePerGas: feeEstimate.maxPriorityFeePerGas,
    })
    l1FeeEstimate = await estimateL1Fee(client, serialized)
    operatorFeeEstimate = await estimateOperatorFee(client, gasLimit)
    maximumGasCost =
      gasLimit * feeEstimate.maxFeePerGas +
      ceilMultiply(l1FeeEstimate, policy.l1FeeMultiplierBps) +
      ceilMultiply(operatorFeeEstimate, policy.operatorFeeMultiplierBps)
    const nextMinimumProfit = maximum(
      policy.minimumContractProfit,
      maximumGasCost + policy.minimumNetProfit,
    )
    if (nextMinimumProfit === minimumProfit) break
    minimumProfit = nextMinimumProfit
  }

  const conservativeQuotedGross =
    (candidate.exactGrossProfit * policy.quoteProfitSafetyBps) / BPS_DENOMINATOR
  if (conservativeQuotedGross < minimumProfit) {
    throw new Error('positive gross quote does not clear gas, net profit, and quote safety gates')
  }
  if (state.signerEthBalance < policy.reserveFloor + maximumGasCost) {
    throw new Error('signer ETH would fall below the reserve floor')
  }

  const finalArgs = [route, candidate.amountIn, minimumProfit, deadline, validThroughBlock] as const
  const simulation = await client.simulateContract({
    account: account.address,
    address: state.executor,
    abi: BASE_EXECUTOR_ABI,
    functionName: 'execute',
    args: finalArgs,
  })
  const simulatedGrossProfit = simulation.result[1]
  if (simulatedGrossProfit < minimumProfit)
    throw new Error('full executor simulation missed profit floor')

  const finalData = encodeFunctionData({
    abi: BASE_EXECUTOR_ABI,
    functionName: 'execute',
    args: finalArgs,
  })
  serialized = await account.signTransaction({
    chainId: 8453,
    type: 'eip1559',
    to: state.executor,
    data: finalData,
    value: 0n,
    nonce,
    gas: gasLimit,
    maxFeePerGas: feeEstimate.maxFeePerGas,
    maxPriorityFeePerGas: feeEstimate.maxPriorityFeePerGas,
  })
  const transactionHash = keccak256(serialized)
  const attemptId = `${candidate.blockNumber.toString()}:${transactionHash}`
  return {
    attemptId,
    transactionHash,
    serialized,
    nonce,
    executor: state.executor,
    signer: account.address,
    token: candidate.token.address,
    tokenSymbol: candidate.token.symbol,
    entryPool: candidate.entryPool,
    exitPool: candidate.exitPool,
    routeHash,
    entryVenue: candidate.entryVenue,
    entryVenueCode: candidate.entryVenueCode,
    entryFee: candidate.entryFee,
    exitVenue: candidate.exitVenue,
    exitVenueCode: candidate.exitVenueCode,
    exitFee: candidate.exitFee,
    amountIn: candidate.amountIn,
    minimumProfit,
    simulatedGrossProfit,
    quoteBlockNumber: candidate.blockNumber,
    quoteBlockHash: candidate.blockHash,
    deadline,
    validThroughBlock,
    gasLimit,
    maxFeePerGas: feeEstimate.maxFeePerGas,
    maxPriorityFeePerGas: feeEstimate.maxPriorityFeePerGas,
    l1FeeEstimate,
    operatorFeeEstimate,
    maximumGasCost,
    executorWethBefore: state.executorWethBalance,
    signerEthBefore: state.signerEthBalance,
  }
}

export interface BroadcastResult {
  readonly endpoint: string
  readonly accepted: boolean
  readonly responseCode: number | string
}

function endpointLabel(value: string): string {
  const endpoint = new URL(value)
  return `${endpoint.protocol}//${endpoint.host}`
}

async function broadcastOne(
  endpoint: string,
  serialized: Hex,
  expectedHash: Hash,
): Promise<BroadcastResult> {
  try {
    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendRawTransaction',
        params: [serialized],
      }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      return { endpoint: endpointLabel(endpoint), accepted: false, responseCode: response.status }
    }
    const body = (await response.json()) as {
      readonly result?: unknown
      readonly error?: { readonly code?: unknown }
    }
    if (
      typeof body.result === 'string' &&
      body.result.toLowerCase() === expectedHash.toLowerCase()
    ) {
      return { endpoint: endpointLabel(endpoint), accepted: true, responseCode: 'accepted' }
    }
    return {
      endpoint: endpointLabel(endpoint),
      accepted: false,
      responseCode: typeof body.error?.code === 'number' ? body.error.code : 'invalid_rpc_response',
    }
  } catch (error) {
    return {
      endpoint: endpointLabel(endpoint),
      accepted: false,
      responseCode: error instanceof Error ? error.name : 'broadcast_error',
    }
  }
}

export async function broadcastRawTransaction(
  endpoints: readonly string[],
  serialized: Hex,
  expectedHash: Hash,
): Promise<readonly BroadcastResult[]> {
  return Promise.all(endpoints.map((endpoint) => broadcastOne(endpoint, serialized, expectedHash)))
}

async function rawL1Fee(
  endpoints: readonly string[],
  transactionHash: Hash,
): Promise<bigint | null> {
  for (const endpoint of endpoints) {
    try {
      const response = await globalThis.fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionReceipt',
          params: [transactionHash],
        }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) continue
      const body = (await response.json()) as {
        readonly result?: { readonly l1Fee?: unknown } | null
      }
      const value = body.result?.l1Fee
      if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value)
    } catch {
      // Try the next independent endpoint.
    }
  }
  return null
}

async function actualOperatorFee(
  client: BaseReadClient,
  gasUsed: bigint,
  blockNumber: bigint,
): Promise<bigint | null> {
  try {
    return await client.readContract({
      address: BASE_GAS_PRICE_ORACLE,
      abi: GAS_PRICE_ORACLE_ABI,
      functionName: 'getOperatorFee',
      args: [gasUsed],
      blockNumber,
    })
  } catch {
    return null
  }
}

function executionEvent(receipt: TransactionReceipt, executor: Address) {
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, executor)) continue
    try {
      return decodeEventLog({
        abi: BASE_EXECUTOR_ABI,
        eventName: 'Executed',
        data: log.data,
        topics: log.topics,
      }).args
    } catch {
      // This executor log is not the Executed event.
    }
  }
  return null
}

export async function reconcileReceipt(
  client: BaseReadClient,
  policy: BaseLivePolicy,
  ledgerPath: string,
  plan: ReceiptReconciliationPlan,
  receipt: TransactionReceipt,
): Promise<ReconciledEffect> {
  const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber })
  const canonical = canonicalBlock.hash === receipt.blockHash
  const executorWethAfter = await client.readContract({
    address: BASE_WETH,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [plan.executor],
  })
  const l1Fee = await rawL1Fee(policy.broadcastRpcUrls, plan.transactionHash)
  const operatorFee = await actualOperatorFee(client, receipt.gasUsed, receipt.blockNumber)
  const l2Fee = receipt.gasUsed * receipt.effectiveGasPrice
  const gasCost = l1Fee === null || operatorFee === null ? null : l2Fee + l1Fee + operatorFee

  let outcome: LiveEffectOutcome
  let grossProfit: bigint | null = null
  let economicNet: bigint | null = null
  let reason: string | null = null
  if (!canonical) {
    outcome = 'DISPUTED'
    reason = 'receipt block is not canonical'
  } else if (l1Fee === null) {
    outcome = 'DISPUTED'
    reason = 'Base L1 data fee is unavailable'
  } else if (operatorFee === null) {
    outcome = 'DISPUTED'
    reason = 'Base operator fee is unavailable'
  } else if (receipt.status === 'reverted') {
    if (executorWethAfter !== plan.executorWethBefore) {
      outcome = 'DISPUTED'
      reason = 'reverted receipt has an unexplained executor WETH delta'
    } else {
      outcome = 'RECONCILED_REVERT'
    }
  } else {
    const event = executionEvent(receipt, plan.executor)
    if (event === null) {
      outcome = 'DISPUTED'
      reason = 'successful receipt is missing the canonical Executed event'
    } else {
      grossProfit = event.grossProfit
      const balanceDelta =
        executorWethAfter >= plan.executorWethBefore
          ? executorWethAfter - plan.executorWethBefore
          : null
      if (
        !isAddressEqual(event.intermediateToken, plan.token) ||
        !isAddressEqual(event.entryPool, plan.entryPool) ||
        !isAddressEqual(event.exitPool, plan.exitPool) ||
        event.routeHash !== plan.routeHash ||
        event.entryVenue !== plan.entryVenueCode ||
        event.exitVenue !== plan.exitVenueCode ||
        event.amountIn !== plan.amountIn ||
        event.amountOut !== event.amountIn + event.grossProfit ||
        balanceDelta === null ||
        event.grossProfit !== balanceDelta ||
        event.grossProfit < plan.minimumProfit
      ) {
        outcome = 'DISPUTED'
        reason = 'receipt event and canonical balance effect do not reconcile'
      } else {
        if (gasCost === null) throw new Error('unreachable missing gas cost')
        economicNet = event.grossProfit - gasCost
        if (economicNet < policy.minimumNetProfit) {
          outcome = 'DISPUTED'
          reason = 'economic net profit missed the approved floor'
        } else {
          outcome = 'RECONCILED_SUCCESS'
        }
      }
    }
  }

  await appendLiveLedger(ledgerPath, {
    attemptId: plan.attemptId,
    stage: 'EFFECT',
    transactionHash: plan.transactionHash,
    nonce: plan.nonce,
    outcome,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    l1Fee,
    operatorFee,
    gasCostWei: gasCost,
    executorWethAfter,
    grossProfit,
    economicNet,
    reason,
  })
  return {
    outcome,
    transactionHash: plan.transactionHash,
    gasCost,
    grossProfit,
    economicNet,
    blockNumber: receipt.blockNumber,
    reason,
  }
}

export async function broadcastAndReconcile(
  client: BaseReadClient,
  policy: BaseLivePolicy,
  ledgerPath: string,
  plan: PreparedLivePlan,
): Promise<ReconciledEffect> {
  await appendLiveLedger(ledgerPath, {
    attemptId: plan.attemptId,
    stage: 'PLAN',
    transactionHash: plan.transactionHash,
    nonce: plan.nonce,
    approvalRef: policy.authorizationId,
    executor: plan.executor,
    signer: plan.signer,
    token: plan.token,
    tokenSymbol: plan.tokenSymbol,
    entryPool: plan.entryPool,
    exitPool: plan.exitPool,
    routeHash: plan.routeHash,
    entryVenue: plan.entryVenue,
    entryVenueCode: plan.entryVenueCode,
    entryFee: plan.entryFee,
    exitVenue: plan.exitVenue,
    exitVenueCode: plan.exitVenueCode,
    exitFee: plan.exitFee,
    amountIn: plan.amountIn,
    minimumProfit: plan.minimumProfit,
    simulatedGrossProfit: plan.simulatedGrossProfit,
    quoteBlockNumber: plan.quoteBlockNumber,
    quoteBlockHash: plan.quoteBlockHash,
    deadline: plan.deadline,
    validThroughBlock: plan.validThroughBlock,
    gasLimit: plan.gasLimit,
    maxFeePerGas: plan.maxFeePerGas,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
    l1FeeEstimate: plan.l1FeeEstimate,
    operatorFeeEstimate: plan.operatorFeeEstimate,
    maximumGasCost: plan.maximumGasCost,
    executorWethBefore: plan.executorWethBefore,
    signerEthBefore: plan.signerEthBefore,
  })

  const results = await broadcastRawTransaction(
    policy.broadcastRpcUrls,
    plan.serialized,
    plan.transactionHash,
  )
  await appendLiveLedger(ledgerPath, {
    attemptId: plan.attemptId,
    stage: 'BROADCAST',
    transactionHash: plan.transactionHash,
    nonce: plan.nonce,
    endpoints: results,
    acceptedCount: results.filter((result) => result.accepted).length,
  })

  try {
    const receipt = await client.waitForTransactionReceipt({
      hash: plan.transactionHash,
      confirmations: 2,
      timeout: 30_000,
    })
    return await reconcileReceipt(client, policy, ledgerPath, plan, receipt)
  } catch (error) {
    await appendLiveLedger(ledgerPath, {
      attemptId: plan.attemptId,
      stage: 'UNKNOWN',
      transactionHash: plan.transactionHash,
      nonce: plan.nonce,
      reason: error instanceof Error ? error.name : 'receipt_wait_error',
    })
    return {
      outcome: 'DISPUTED',
      transactionHash: plan.transactionHash,
      gasCost: null,
      grossProfit: null,
      economicNet: null,
      blockNumber: null,
      reason: 'receipt remains UNKNOWN; new risk is halted',
    }
  }
}
