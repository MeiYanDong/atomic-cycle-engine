import { mkdir, open, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { appendEvidence } from '../../evidence/jsonl-store.js'

export type LiveAttemptStage = 'PLAN' | 'BROADCAST' | 'UNKNOWN' | 'EFFECT'
export type LiveEffectOutcome = 'RECONCILED_SUCCESS' | 'RECONCILED_REVERT' | 'DISPUTED'

export interface LiveLedgerRecord {
  readonly schemaVersion: 1
  readonly recordedAt: string
  readonly attemptId: string
  readonly stage: LiveAttemptStage
  readonly transactionHash: string
  readonly nonce: number
  readonly outcome?: LiveEffectOutcome
  readonly gasCostWei?: string
  readonly [key: string]: unknown
}

export interface LiveLedgerSummary {
  readonly recordCount: number
  readonly unresolvedAttempt: LiveLedgerRecord | null
  readonly cumulativeFailedGasWei: bigint
  readonly cumulativeEconomicNetWei: bigint
  readonly reconciledSuccessCount: number
  readonly reconciledRevertCount: number
  readonly disputedCount: number
}

function isRecord(value: unknown): value is LiveLedgerRecord {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<LiveLedgerRecord>
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.recordedAt === 'string' &&
    typeof candidate.attemptId === 'string' &&
    typeof candidate.stage === 'string' &&
    typeof candidate.transactionHash === 'string' &&
    typeof candidate.nonce === 'number'
  )
}

export async function readLiveLedger(ledgerPath: string): Promise<readonly LiveLedgerRecord[]> {
  let content: string
  try {
    content = await readFile(ledgerPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const records: LiveLedgerRecord[] = []
  for (const [index, line] of content.split('\n').entries()) {
    if (line.trim() === '') continue
    const parsed: unknown = JSON.parse(line)
    if (!isRecord(parsed))
      throw new Error(`invalid live ledger record at line ${String(index + 1)}`)
    records.push(parsed)
  }
  return records
}

export function summarizeLiveLedger(records: readonly LiveLedgerRecord[]): LiveLedgerSummary {
  const latestByAttempt = new Map<string, LiveLedgerRecord>()
  let cumulativeFailedGasWei = 0n
  let cumulativeEconomicNetWei = 0n
  let reconciledSuccessCount = 0
  let reconciledRevertCount = 0
  let disputedCount = 0
  for (const record of records) {
    latestByAttempt.set(record.attemptId, record)
    if (record.stage !== 'EFFECT') continue
    if (record.outcome === 'RECONCILED_SUCCESS') {
      reconciledSuccessCount += 1
      const economicNet = record.economicNet
      if (typeof economicNet !== 'string' || !/^\d+$/.test(economicNet)) {
        throw new Error(`successful attempt ${record.attemptId} has no valid economic net`)
      }
      cumulativeEconomicNetWei += BigInt(economicNet)
    }
    if (record.outcome === 'RECONCILED_REVERT') {
      reconciledRevertCount += 1
      if (record.gasCostWei === undefined || !/^\d+$/.test(record.gasCostWei)) {
        throw new Error(`reverted attempt ${record.attemptId} has no valid gas cost`)
      }
      cumulativeFailedGasWei += BigInt(record.gasCostWei)
    }
    if (record.outcome === 'DISPUTED') disputedCount += 1
  }
  const unresolved = [...latestByAttempt.values()].filter(
    (record) => record.stage !== 'EFFECT' || record.outcome === 'DISPUTED',
  )
  return {
    recordCount: records.length,
    unresolvedAttempt: unresolved.at(-1) ?? null,
    cumulativeFailedGasWei,
    cumulativeEconomicNetWei,
    reconciledSuccessCount,
    reconciledRevertCount,
    disputedCount,
  }
}

export async function appendLiveLedger(
  ledgerPath: string,
  record: Omit<LiveLedgerRecord, 'schemaVersion' | 'recordedAt'>,
): Promise<void> {
  await appendEvidence(ledgerPath, {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    ...record,
  })
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EPERM'
  }
}

export async function acquireLiveFence(
  stateDirectory: string,
): Promise<Readonly<{ release: () => Promise<void> }>> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  const lockPath = path.join(stateDirectory, 'nonce-owner.lock')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const file = await open(lockPath, 'wx', 0o600)
      await file.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      )
      await file.close()
      let released = false
      return {
        release: async () => {
          if (released) return
          released = true
          await rm(lockPath, { force: true })
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly pid?: unknown }
      if (typeof existing.pid === 'number' && processExists(existing.pid)) {
        throw new Error(`live nonce owner already active with pid ${String(existing.pid)}`, {
          cause: error,
        })
      }
      await rm(lockPath, { force: true })
    }
  }
  throw new Error('failed to acquire live nonce fence')
}
