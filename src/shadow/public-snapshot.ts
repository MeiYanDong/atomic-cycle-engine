import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { formatUnits } from 'viem'

import type { CrossVenueProfile, CrossVenueScan } from './cross-venue.js'
import type { RpcQuoteStats } from './rpc-quote.js'

export const PUBLIC_SHADOW_SCHEMA_VERSION = 1
export const PUBLIC_SHADOW_MODE = 'READ_ONLY_CROSS_VENUE_SHADOW'

export interface ShadowNetworkObservation {
  readonly profile: CrossVenueProfile
  readonly observedAt: string
  readonly scan: CrossVenueScan | null
  readonly quoteStats: RpcQuoteStats
  readonly reasonCode: 'NONE' | 'RPC_OR_QUOTE_UNAVAILABLE' | 'REORG_DETECTED'
}

function decimal(value: bigint, decimals: number): string {
  return formatUnits(value, decimals)
}

function publicCandidate(candidate: CrossVenueScan['candidates'][number]) {
  const decimals = candidate.baseAsset.decimals
  return {
    chain: candidate.network === 'bnb' ? 'BNB Chain' : 'Robinhood Chain',
    pair: `${candidate.baseAsset.symbol}/${candidate.target.symbol}`,
    route: `${candidate.entryVenue.label} → ${candidate.exitVenue.label}`,
    principal: `${decimal(candidate.amountIn, decimals)} ${candidate.baseAsset.symbol}`,
    grossProfit: `${decimal(candidate.grossProfit, decimals)} ${candidate.baseAsset.symbol}`,
    estimatedGasCost: `${decimal(candidate.estimatedGasCost, decimals)} ${candidate.baseAsset.symbol}`,
    riskReserve: `${decimal(candidate.riskBuffer, decimals)} ${candidate.baseAsset.symbol}`,
    estimatedNetProfit: `${decimal(candidate.estimatedNetProfit, decimals)} ${candidate.baseAsset.symbol}`,
    result:
      candidate.disposition === 'SHADOW_POSITIVE_NOT_EXECUTABLE'
        ? '影子净收益为正，尚未授权执行'
        : '计入 Gas 与风险储备后不盈利',
    blockHeight: candidate.state.blockNumber.toString(),
    blockCommitment: candidate.state.blockHash,
  }
}

export function buildPublicShadowSnapshot(observations: readonly ShadowNetworkObservation[]) {
  const networks = observations.map((observation) => {
    const { profile, scan, quoteStats } = observation
    const candidates = scan?.candidates ?? []
    const selected = candidates.some((candidate) => candidate.estimatedNetProfit > 0n)
      ? candidates.filter((candidate) => candidate.estimatedNetProfit > 0n).slice(0, 10)
      : candidates.slice(0, 3)
    const partial = scan === null || quoteStats.failedRpcCalls > 0
    return {
      id: profile.network,
      name: profile.network === 'bnb' ? 'BNB Chain' : 'Robinhood Chain',
      observedAt: observation.observedAt,
      status: partial ? 'PARTIAL' : 'CURRENT',
      reasonCode:
        observation.reasonCode === 'NONE' && partial
          ? 'RPC_OR_QUOTE_UNAVAILABLE'
          : observation.reasonCode,
      coverage: {
        venues: profile.venues.map((venue) => venue.label),
        assets: profile.targets.map((asset) => asset.symbol),
        configuredPrincipalSizes: profile.amountsIn.map(
          (amount) => `${decimal(amount, profile.baseAsset.decimals)} ${profile.baseAsset.symbol}`,
        ),
        principalProbePolicy: '最小金额毛利为正后才扩大金额',
      },
      funnel: {
        attemptedCycles: scan?.attemptedCycles ?? 0,
        fullyQuotedCycles: scan?.quoteCompleteCycles ?? 0,
        grossPositiveCycles: scan?.positiveGrossCycles ?? 0,
        gasAdjustedPositiveCycles: scan?.positiveNetCycles ?? 0,
        executableCycles: 0,
      },
      readCost: {
        logicalQuotes: quoteStats.logicalQuotes,
        providerRequests: quoteStats.rpcCalls,
        failedProviderRequests: quoteStats.failedRpcCalls,
      },
      evidence:
        scan === null
          ? null
          : {
              blockHeight: scan.state.blockNumber.toString(),
              blockCommitment: scan.state.blockHash,
            },
      bestObservedRoutes: selected.map(publicCandidate),
    }
  })
  return {
    schemaVersion: PUBLIC_SHADOW_SCHEMA_VERSION,
    kind: 'cross_venue_opportunity_snapshot',
    generatedAt: new Date().toISOString(),
    mode: PUBLIC_SHADOW_MODE,
    signingEnabled: false,
    broadcastEnabled: false,
    note: '这是固定区块只读报价，不是交易授权；只有链上执行回执和资产增量才能记为收益。',
    networks,
  }
}

export function assertPublicShadowSnapshot(snapshot: unknown): void {
  const rendered = JSON.stringify(snapshot)
  if (rendered.length > 256_000) throw new Error('public shadow snapshot exceeds size limit')
  if (
    /private.?key|mnemonic|signed.?transaction|webhook|rpc.?url|wallet.?address/i.test(rendered)
  ) {
    throw new Error('public shadow snapshot contains a forbidden field')
  }
  const value = snapshot as { schemaVersion?: unknown; mode?: unknown; networks?: unknown }
  if (value.schemaVersion !== PUBLIC_SHADOW_SCHEMA_VERSION || value.mode !== PUBLIC_SHADOW_MODE) {
    throw new Error('public shadow snapshot identity is invalid')
  }
  if (!Array.isArray(value.networks)) throw new Error('public shadow networks must be an array')
}

export async function writePublicShadowSnapshot(
  outputPath: string,
  snapshot: unknown,
): Promise<void> {
  if (!isAbsolute(outputPath)) throw new Error('public shadow output path must be absolute')
  assertPublicShadowSnapshot(snapshot)
  const directory = dirname(outputPath)
  await mkdir(directory, { recursive: true, mode: 0o755 })
  const temporaryPath = `${outputPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  })
  await chmod(temporaryPath, 0o644)
  await rename(temporaryPath, outputPath)
  await chmod(outputPath, 0o644)
}
