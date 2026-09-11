import console from 'node:console'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

import { formatEther, getAddress, type Hash } from 'viem'

import { appendEvidence } from '../evidence/jsonl-store.js'
import { createBaseReadClient } from '../live/base-v2-v3/client.js'
import { loadSignerAccount } from '../live/base-v2-v3/credential.js'
import {
  broadcastAndReconcile,
  prepareLivePlan,
  reconcileReceipt,
  type PreparedLivePlan,
  type ReceiptReconciliationPlan,
} from '../live/base-v2-v3/execution.js'
import {
  acquireLiveFence,
  readLiveLedger,
  summarizeLiveLedger,
  type LiveLedgerRecord,
} from '../live/base-v2-v3/ledger.js'
import { amountGrid, loadBaseLivePolicy } from '../live/base-v2-v3/policy.js'
import { writeBasePublicHeartbeat } from '../live/base-v2-v3/public-heartbeat.js'
import { quoteBaseTokenCycles, type BaseCycleQuote } from '../live/base-v2-v3/quote.js'
import { BASE_CANARY_TOKENS } from '../live/base-v2-v3/tokens.js'

function safeGateReason(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_ERROR'
  const known = [
    'candidate is not a positive exact quote',
    'candidate exceeds principal cap',
    'live execution policy is not armed',
    'executor has no deployed code',
    'signer is not the executor operator',
    'executor is disarmed',
    'candidate token is not approved on the executor',
    'on-chain and runtime principal caps differ',
    'on-chain and runtime contract profit floors differ',
    'executor principal is insufficient',
    'quote block commitment mismatch',
    'current Base max fee exceeds the live policy cap',
    'positive gross quote does not clear gas, net profit, and quote safety gates',
    'signer ETH would fall below the reserve floor',
    'full executor simulation missed profit floor',
  ]
  return known.includes(error.message) ? error.message : error.name
}

function requiredString(record: LiveLedgerRecord, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') throw new Error(`ledger PLAN is missing ${key}`)
  return value
}

function requiredBigint(record: LiveLedgerRecord, key: string): bigint {
  const value = requiredString(record, key)
  if (!/^\d+$/.test(value)) throw new Error(`ledger PLAN ${key} is invalid`)
  return BigInt(value)
}

function requiredBoolean(record: LiveLedgerRecord, key: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new Error(`ledger PLAN is missing ${key}`)
  return value
}

function requiredHash(record: LiveLedgerRecord, key: string): Hash {
  const value = requiredString(record, key)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`ledger PLAN ${key} is invalid`)
  return value as Hash
}

function reconciliationPlan(
  records: readonly LiveLedgerRecord[],
  attemptId: string,
): ReceiptReconciliationPlan {
  const record = records.findLast(
    (candidate) => candidate.attemptId === attemptId && candidate.stage === 'PLAN',
  )
  if (record === undefined) throw new Error('unresolved attempt has no durable PLAN')
  const transactionHash = requiredHash(record, 'transactionHash')
  return {
    attemptId,
    transactionHash,
    nonce: record.nonce,
    executor: getAddress(requiredString(record, 'executor')),
    token: getAddress(requiredString(record, 'token')),
    v3Pool: getAddress(requiredString(record, 'v3Pool')),
    routeHash: requiredHash(record, 'routeHash'),
    v2First: requiredBoolean(record, 'v2First'),
    amountIn: requiredBigint(record, 'amountIn'),
    minimumProfit: requiredBigint(record, 'minimumProfit'),
    executorWethBefore: requiredBigint(record, 'executorWethBefore'),
  }
}

async function writePrivateHeartbeat(
  stateDirectory: string,
  heartbeat: Readonly<Record<string, unknown>>,
): Promise<void> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  const finalPath = path.join(stateDirectory, 'heartbeat.json')
  const temporaryPath = path.join(stateDirectory, `.heartbeat-${String(process.pid)}.tmp`)
  await writeFile(temporaryPath, `${JSON.stringify(heartbeat, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryPath, finalPath)
}

async function scanAll(
  maximumAmountIn: bigint,
): Promise<Readonly<{ quotes: readonly BaseCycleQuote[]; failures: readonly string[] }>> {
  const quotes: BaseCycleQuote[] = []
  const failures: string[] = []
  for (const token of BASE_CANARY_TOKENS) {
    try {
      quotes.push(...(await quoteBaseTokenCycles(client, token, amountGrid(maximumAmountIn))))
    } catch (error) {
      failures.push(`${token.symbol}:${error instanceof Error ? error.name : 'UNKNOWN_ERROR'}`)
    }
  }
  return { quotes, failures }
}

async function reconcileOnStartup(records: readonly LiveLedgerRecord[]): Promise<boolean> {
  const summary = summarizeLiveLedger(records)
  if (summary.unresolvedAttempt === null) return true
  const plan = reconciliationPlan(records, summary.unresolvedAttempt.attemptId)
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash: plan.transactionHash,
      confirmations: 2,
      timeout: 30_000,
    })
    const effect = await reconcileReceipt(client, policy, ledgerPath, plan, receipt)
    return effect.outcome !== 'DISPUTED'
  } catch {
    await publishHeartbeat({
      运行状态: '停止新增交易',
      原因: '上一笔交易仍未完成链上对账',
      交易哈希: plan.transactionHash,
      更新时间: new Date().toISOString(),
    })
    return false
  }
}

function sortPositiveGross(quotes: readonly BaseCycleQuote[]): readonly BaseCycleQuote[] {
  return quotes
    .filter(
      (quote): quote is BaseCycleQuote & { exactGrossProfit: bigint } =>
        quote.disposition === 'POSITIVE_GROSS' && quote.exactGrossProfit !== null,
    )
    .sort((left, right) =>
      left.exactGrossProfit === right.exactGrossProfit
        ? 0
        : left.exactGrossProfit > right.exactGrossProfit
          ? -1
          : 1,
    )
}

const policy = loadBaseLivePolicy(process.env)
if (!policy.liveArm) throw new Error('watcher refuses to start because BASE_LIVE_ARM is not 1')
if (policy.executorAddress === null) {
  throw new Error('watcher refuses to start without BASE_EXECUTOR_ADDRESS')
}
const client = createBaseReadClient(process.env.BASE_READ_RPC_URL)
const account = await loadSignerAccount({
  ...(process.env.CREDENTIALS_DIRECTORY === undefined
    ? {}
    : { credentialsDirectory: process.env.CREDENTIALS_DIRECTORY }),
  ...(process.env.BASE_SIGNER_CREDENTIAL_FILE === undefined
    ? {}
    : { explicitCredentialFile: process.env.BASE_SIGNER_CREDENTIAL_FILE }),
})
const publicHeartbeatPath = process.env.BASE_PUBLIC_HEARTBEAT_PATH
if (publicHeartbeatPath !== undefined && !path.isAbsolute(publicHeartbeatPath)) {
  throw new Error('BASE_PUBLIC_HEARTBEAT_PATH must be absolute')
}
async function publishHeartbeat(heartbeat: Readonly<Record<string, unknown>>): Promise<void> {
  const identified = {
    ...heartbeat,
    钱包: account.address,
    合约: policy.executorAddress,
  }
  await writePrivateHeartbeat(policy.stateDirectory, identified)
  if (publicHeartbeatPath === undefined) return
  try {
    await writeBasePublicHeartbeat(publicHeartbeatPath, identified)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'PUBLIC_HEARTBEAT_WRITE_FAILED',
        reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      }),
    )
  }
}
const ledgerPath = path.join(policy.stateDirectory, 'attempts.jsonl')
const observationPath = path.join(policy.stateDirectory, 'observations.jsonl')
const fence = await acquireLiveFence(policy.stateDirectory)
const shutdown = new AbortController()
process.on('SIGTERM', () => {
  shutdown.abort()
})
process.on('SIGINT', () => {
  shutdown.abort()
})

try {
  await publishHeartbeat({
    运行状态: '正在启动实盘监控',
    钱包: account.address,
    合约: policy.executorAddress,
    更新时间: new Date().toISOString(),
  })
  const initialRecords = await readLiveLedger(ledgerPath)
  if (!(await reconcileOnStartup(initialRecords))) {
    throw new Error('unresolved prior attempt blocks the nonce lane')
  }
  let tick = 0
  do {
    tick += 1
    const records = await readLiveLedger(ledgerPath)
    const summary = summarizeLiveLedger(records)
    if (summary.unresolvedAttempt !== null) {
      throw new Error('unresolved attempt appeared while watcher was active')
    }
    if (summary.cumulativeFailedGasWei >= policy.cumulativeFailedGasCap) {
      await publishHeartbeat({
        运行状态: '已触发 Gas 熔断',
        累计失败Gas_ETH: formatEther(summary.cumulativeFailedGasWei),
        熔断上限_ETH: formatEther(policy.cumulativeFailedGasCap),
        更新时间: new Date().toISOString(),
      })
      throw new Error('cumulative failed gas cap reached')
    }

    const scan = await scanAll(policy.maximumAmountIn)
    const positives = sortPositiveGross(scan.quotes)
    let attempted = false
    const gateReasons: string[] = []
    for (const candidate of positives) {
      let plan: PreparedLivePlan
      try {
        plan = await prepareLivePlan(client, account, policy, candidate)
      } catch (error) {
        gateReasons.push(safeGateReason(error))
        continue
      }
      const effect = await broadcastAndReconcile(client, policy, ledgerPath, plan)
      attempted = true
      if (effect.outcome === 'DISPUTED') {
        throw new Error('broadcast effect is disputed; new risk is halted')
      }
      break
    }

    const updatedSummary = summarizeLiveLedger(await readLiveLedger(ledgerPath))
    const latestBlock = scan.quotes.at(-1)?.blockNumber ?? null
    const heartbeat = {
      运行状态: '实盘监控中',
      钱包: account.address,
      合约: policy.executorAddress,
      本轮检查路线: scan.quotes.length,
      毛利为正候选: positives.length,
      本轮是否广播: attempted,
      已确认盈利交易: updatedSummary.reconciledSuccessCount,
      已确认回滚交易: updatedSummary.reconciledRevertCount,
      累计净利润_ETH: formatEther(updatedSummary.cumulativeEconomicNetWei),
      累计失败Gas_ETH: formatEther(updatedSummary.cumulativeFailedGasWei),
      RPC异常源: scan.failures,
      主要拦截原因: [...new Set(gateReasons)].slice(0, 5),
      最新观察区块: latestBlock?.toString() ?? null,
      更新时间: new Date().toISOString(),
    }
    await publishHeartbeat(heartbeat)
    if (tick === 1 || tick % 3 === 0 || attempted || positives.length > 0) {
      console.log(JSON.stringify(heartbeat))
    }
    if (process.env.BASE_WATCH_ONCE === '1') break
    await delay(policy.pollIntervalMs, undefined, { signal: shutdown.signal }).catch((error) => {
      if (!shutdown.signal.aborted) throw error
    })
  } while (!shutdown.signal.aborted)
} finally {
  await appendEvidence(observationPath, {
    recordedAt: new Date().toISOString(),
    event: 'WATCHER_STOPPED',
    graceful: shutdown.signal.aborted,
  })
  await fence.release()
}
