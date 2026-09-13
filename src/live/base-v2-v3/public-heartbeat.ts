import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { getAddress, isAddress } from 'viem'

import { isSafePublicGateReason } from './gate-reason.js'

export const BASE_PUBLIC_HEARTBEAT_SCHEMA_VERSION = 2
export const BASE_PUBLIC_HEARTBEAT_MODE = 'READ_ONLY_SANITIZED_BASE_RUNTIME'
const BASE_PUBLIC_HEARTBEAT_KEYS = Object.freeze([
  'schemaVersion',
  'mode',
  'generatedAt',
  'runtimeStatus',
  'operator',
  'executor',
  'routesChecked',
  'positiveGrossCandidates',
  'bestGrossProfitEth',
  'fullLiveGateCandidates',
  'primaryBlockReason',
  'broadcastAttempted',
  'confirmedProfitTransactions',
  'confirmedRevertedTransactions',
  'verifiedNetEth',
  'failedGasEth',
  'latestObservedBlock',
])

export interface BasePublicHeartbeat {
  readonly schemaVersion: 2
  readonly mode: typeof BASE_PUBLIC_HEARTBEAT_MODE
  readonly generatedAt: string
  readonly runtimeStatus: 'RUNNING' | 'STARTING' | 'HALTED' | 'UNKNOWN'
  readonly operator: string | null
  readonly executor: string | null
  readonly routesChecked: number | null
  readonly positiveGrossCandidates: number | null
  readonly bestGrossProfitEth: string | null
  readonly fullLiveGateCandidates: number | null
  readonly primaryBlockReason: string | null
  readonly broadcastAttempted: boolean | null
  readonly confirmedProfitTransactions: number | null
  readonly confirmedRevertedTransactions: number | null
  readonly verifiedNetEth: string | null
  readonly failedGasEth: string | null
  readonly latestObservedBlock: string | null
}

function optionalNonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function optionalDecimal(value: unknown): string | null {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? value : null
}

function optionalAddress(value: unknown): string | null {
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : null
}

function firstArrayItem(value: unknown): unknown {
  return Array.isArray(value) ? (value as readonly unknown[])[0] : null
}

function runtimeStatus(value: unknown): BasePublicHeartbeat['runtimeStatus'] {
  if (value === '实盘监控中') return 'RUNNING'
  if (value === '正在启动实盘监控') return 'STARTING'
  if (typeof value === 'string' && (value.includes('熔断') || value.includes('停止')))
    return 'HALTED'
  return 'UNKNOWN'
}

export function projectBasePublicHeartbeat(
  heartbeat: Readonly<Record<string, unknown>>,
): BasePublicHeartbeat {
  const generatedAt = heartbeat['更新时间']
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('private heartbeat has no valid update time')
  }
  const privateReasons = heartbeat['主要拦截原因']
  const primaryReason = firstArrayItem(privateReasons)
  const projected: BasePublicHeartbeat = {
    schemaVersion: BASE_PUBLIC_HEARTBEAT_SCHEMA_VERSION,
    mode: BASE_PUBLIC_HEARTBEAT_MODE,
    generatedAt,
    runtimeStatus: runtimeStatus(heartbeat['运行状态']),
    operator: optionalAddress(heartbeat['钱包']),
    executor: optionalAddress(heartbeat['合约']),
    routesChecked: optionalNonNegativeInteger(heartbeat['本轮检查路线']),
    positiveGrossCandidates: optionalNonNegativeInteger(heartbeat['毛利为正候选']),
    bestGrossProfitEth: optionalDecimal(heartbeat['本轮最高毛利_ETH']),
    fullLiveGateCandidates: optionalNonNegativeInteger(heartbeat['达到完整实盘门槛候选']),
    primaryBlockReason: isSafePublicGateReason(primaryReason) ? primaryReason : null,
    broadcastAttempted:
      typeof heartbeat['本轮是否广播'] === 'boolean' ? heartbeat['本轮是否广播'] : null,
    confirmedProfitTransactions: optionalNonNegativeInteger(heartbeat['已确认盈利交易']),
    confirmedRevertedTransactions: optionalNonNegativeInteger(heartbeat['已确认回滚交易']),
    verifiedNetEth: optionalDecimal(heartbeat['累计净利润_ETH']),
    failedGasEth: optionalDecimal(heartbeat['累计失败Gas_ETH']),
    latestObservedBlock:
      typeof heartbeat['最新观察区块'] === 'string' && /^\d+$/.test(heartbeat['最新观察区块'])
        ? heartbeat['最新观察区块']
        : null,
  }
  return assertBasePublicHeartbeat(projected)
}

export function assertBasePublicHeartbeat(value: unknown): BasePublicHeartbeat {
  if (typeof value !== 'object' || value === null) throw new Error('invalid public heartbeat')
  const heartbeat = value as Partial<BasePublicHeartbeat>
  const serialized = JSON.stringify(heartbeat)
  if (
    /(?:credential|mnemonic|private.?key|raw.?transaction|rpc.?url|secret|signed.?transaction|webhook)/i.test(
      serialized,
    )
  ) {
    throw new Error('public heartbeat contains a forbidden sensitive field')
  }
  const keys = Object.keys(heartbeat)
  if (
    keys.length !== BASE_PUBLIC_HEARTBEAT_KEYS.length ||
    keys.some((key) => !BASE_PUBLIC_HEARTBEAT_KEYS.includes(key))
  ) {
    throw new Error('public heartbeat contains fields outside the allowlist')
  }
  if (
    heartbeat.schemaVersion !== BASE_PUBLIC_HEARTBEAT_SCHEMA_VERSION ||
    heartbeat.mode !== BASE_PUBLIC_HEARTBEAT_MODE ||
    typeof heartbeat.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(heartbeat.generatedAt)) ||
    !['RUNNING', 'STARTING', 'HALTED', 'UNKNOWN'].includes(heartbeat.runtimeStatus || '') ||
    ![heartbeat.operator, heartbeat.executor].every(
      (address) => address === null || (typeof address === 'string' && isAddress(address)),
    ) ||
    ![
      heartbeat.routesChecked,
      heartbeat.positiveGrossCandidates,
      heartbeat.fullLiveGateCandidates,
      heartbeat.confirmedProfitTransactions,
      heartbeat.confirmedRevertedTransactions,
    ].every((count) => count === null || (Number.isSafeInteger(count) && Number(count) >= 0)) ||
    !(heartbeat.broadcastAttempted === null || typeof heartbeat.broadcastAttempted === 'boolean') ||
    ![heartbeat.bestGrossProfitEth, heartbeat.verifiedNetEth, heartbeat.failedGasEth].every(
      (amount) => amount === null || (typeof amount === 'string' && /^\d+(?:\.\d+)?$/.test(amount)),
    ) ||
    !(
      heartbeat.primaryBlockReason === null || isSafePublicGateReason(heartbeat.primaryBlockReason)
    ) ||
    !(
      heartbeat.latestObservedBlock === null ||
      (typeof heartbeat.latestObservedBlock === 'string' &&
        /^\d+$/.test(heartbeat.latestObservedBlock))
    )
  ) {
    throw new Error('invalid public heartbeat identity')
  }
  return heartbeat as BasePublicHeartbeat
}

export async function writeBasePublicHeartbeat(
  filePath: string,
  heartbeat: Readonly<Record<string, unknown>>,
): Promise<void> {
  const projected = projectBasePublicHeartbeat(heartbeat)
  await mkdir(dirname(filePath), { recursive: true, mode: 0o750 })
  const temporaryPath = `${filePath}.${String(process.pid)}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(projected, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o640,
  })
  await chmod(temporaryPath, 0o640)
  await rename(temporaryPath, filePath)
}
