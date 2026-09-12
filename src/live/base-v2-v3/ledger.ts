import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
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

interface LiveFenceRecord {
  readonly schemaVersion?: number
  readonly pid: number
  readonly createdAt: string
  readonly ownerToken?: string
  readonly bootId?: string
  readonly processStartTicks?: string
}

export interface LiveFenceProcessObservation {
  readonly exists: boolean
  readonly bootId: string | null
  readonly processStartTicks: string | null
  readonly bootedAtMs: number | null
}

const LEGACY_FENCE_BOOT_SKEW_MS = 60_000

function parseFenceRecord(content: string): LiveFenceRecord {
  const value = JSON.parse(content) as Partial<LiveFenceRecord>
  if (
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) <= 0 ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error('invalid live nonce fence record')
  }
  if (
    value.schemaVersion !== undefined &&
    (value.schemaVersion !== 2 ||
      typeof value.ownerToken !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(value.ownerToken))
  ) {
    throw new Error('invalid live nonce fence identity')
  }
  return value as LiveFenceRecord
}

async function linuxBootId(): Promise<string | null> {
  if (process.platform !== 'linux') return null
  try {
    const value = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
    return /^[0-9a-f-]{36}$/i.test(value) ? value : null
  } catch {
    return null
  }
}

async function linuxBootedAtMs(): Promise<number | null> {
  if (process.platform !== 'linux') return null
  try {
    const content = await readFile('/proc/stat', 'utf8')
    const match = /^btime\s+(\d+)$/m.exec(content)
    if (match?.[1] === undefined) return null
    const seconds = Number(match[1])
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1_000 : null
  } catch {
    return null
  }
}

async function linuxProcessStartTicks(pid: number): Promise<string | null> {
  if (process.platform !== 'linux') return null
  try {
    const content = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
    const commandEnd = content.lastIndexOf(')')
    if (commandEnd < 0) return null
    const fieldsFromState = content
      .slice(commandEnd + 1)
      .trim()
      .split(/\s+/)
    const startTicks = fieldsFromState[19]
    return startTicks !== undefined && /^\d+$/.test(startTicks) ? startTicks : null
  } catch {
    return null
  }
}

async function observeFenceProcess(pid: number): Promise<LiveFenceProcessObservation> {
  const exists = processExists(pid)
  if (!exists) {
    return { exists: false, bootId: null, processStartTicks: null, bootedAtMs: null }
  }
  const [bootId, processStartTicks, bootedAtMs] = await Promise.all([
    linuxBootId(),
    linuxProcessStartTicks(pid),
    linuxBootedAtMs(),
  ])
  return { exists: processExists(pid), bootId, processStartTicks, bootedAtMs }
}

export function liveFenceBelongsToObservedProcess(
  record: Readonly<LiveFenceRecord>,
  observation: Readonly<LiveFenceProcessObservation>,
): boolean {
  if (!observation.exists) return false
  if (record.bootId !== undefined && observation.bootId !== null) {
    if (record.bootId !== observation.bootId) return false
    if (
      record.processStartTicks !== undefined &&
      observation.processStartTicks !== null &&
      record.processStartTicks !== observation.processStartTicks
    ) {
      return false
    }
    return true
  }
  if (
    observation.bootedAtMs !== null &&
    Date.parse(record.createdAt) + LEGACY_FENCE_BOOT_SKEW_MS < observation.bootedAtMs
  ) {
    return false
  }
  return true
}

async function createFenceFile(
  lockPath: string,
  record: Readonly<LiveFenceRecord>,
): Promise<Readonly<{ dev: number; ino: number }>> {
  const file = await open(lockPath, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(record)}\n`)
    await file.sync()
    const metadata = await file.stat()
    return { dev: metadata.dev, ino: metadata.ino }
  } finally {
    await file.close()
  }
}

export async function acquireLiveFence(
  stateDirectory: string,
): Promise<Readonly<{ release: () => Promise<void> }>> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  const lockPath = path.join(stateDirectory, 'nonce-owner.lock')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const ownerToken = randomUUID()
      const identity = await observeFenceProcess(process.pid)
      const record = {
        schemaVersion: 2 as const,
        pid: process.pid,
        createdAt: new Date().toISOString(),
        ownerToken,
        ...(identity.bootId === null ? {} : { bootId: identity.bootId }),
        ...(identity.processStartTicks === null
          ? {}
          : { processStartTicks: identity.processStartTicks }),
      }
      const createdFile = await createFenceFile(lockPath, record)
      let released = false
      return {
        release: async () => {
          if (released) return
          released = true
          try {
            const currentFile = await stat(lockPath)
            if (currentFile.dev !== createdFile.dev || currentFile.ino !== createdFile.ino) return
            const current = parseFenceRecord(await readFile(lockPath, 'utf8'))
            if (current.pid !== process.pid || current.ownerToken !== ownerToken) return
            await rm(lockPath)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = parseFenceRecord(await readFile(lockPath, 'utf8'))
      const observation = await observeFenceProcess(existing.pid)
      if (liveFenceBelongsToObservedProcess(existing, observation)) {
        throw new Error(`live nonce owner already active with pid ${String(existing.pid)}`, {
          cause: error,
        })
      }
      await rm(lockPath, { force: true })
    }
  }
  throw new Error('failed to acquire live nonce fence')
}
