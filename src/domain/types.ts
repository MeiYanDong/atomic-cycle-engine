import type { Address } from 'viem'

export type EvidenceLevel =
  'configured' | 'repository_record' | 'live_observed' | 'receipt_attested' | 'economic_reconciled'

export type AttributionStatus =
  'UNKNOWN' | 'CHAIN_ATTESTED' | 'FIRST_PARTY_ATTESTED' | 'CORROBORATED' | 'CONFLICTED'

export interface AttributionClaim {
  readonly id: string | null
  readonly status: AttributionStatus
  readonly evidenceRefs: readonly string[]
}

/**
 * These dimensions are intentionally orthogonal. A discovery website is not a
 * launch platform, a launch protocol is not a liquidity venue, and none of
 * them determines the quote asset.
 */
export interface SourceProvenance {
  readonly discoverySource: AttributionClaim
  readonly launchPlatform: AttributionClaim
  readonly launchProtocol: AttributionClaim
  readonly liquidityVenue: AttributionClaim
}

export function assertSourceProvenance(provenance: SourceProvenance): void {
  const claims: readonly (readonly [string, AttributionClaim])[] = [
    ['discoverySource', provenance.discoverySource],
    ['launchPlatform', provenance.launchPlatform],
    ['launchProtocol', provenance.launchProtocol],
    ['liquidityVenue', provenance.liquidityVenue],
  ]
  for (const [dimension, claim] of claims) {
    if (claim.status === 'UNKNOWN') {
      if (claim.id !== null) throw new Error(`${dimension} UNKNOWN claim must not invent an id`)
      continue
    }
    if (claim.id === null || claim.evidenceRefs.length === 0) {
      throw new Error(`${dimension} attributed claim requires id and evidence`)
    }
  }
}

export interface AssetRef {
  readonly chainId: number
  readonly address: Address
  readonly symbol: string
  readonly decimals: number
}

export type AssetId = `${number}:${Address}`

export function assetId(asset: Pick<AssetRef, 'chainId' | 'address'>): AssetId {
  return `${asset.chainId}:${asset.address.toLowerCase() as Address}`
}

export type StateBasis = 'FINAL_BLOCK' | 'PENDING_BLOCK' | 'FLASHBLOCK' | 'SYNTHETIC_FIXTURE'

export interface StateReference {
  readonly chainId: number
  readonly basis: StateBasis
  /** A block number, flashblock sequence, or deterministic fixture revision. */
  readonly value: string
  /** Hash or other immutable commitment to the state used by the quote. */
  readonly commitment: string
}

export function sameState(left: StateReference, right: StateReference): boolean {
  return (
    left.chainId === right.chainId &&
    left.basis === right.basis &&
    left.value === right.value &&
    left.commitment === right.commitment
  )
}

export interface QuoteEdge {
  readonly id: string
  readonly chainId: number
  readonly adapterId: string
  /** Pools or vaults sharing the same mutable inventory use one source id. */
  readonly liquiditySourceId: string
  readonly tokenIn: AssetRef
  readonly tokenOut: AssetRef
  readonly provenance: SourceProvenance
}

export interface CycleRoute {
  readonly id: string
  readonly chainId: number
  readonly baseAsset: AssetRef
  readonly edges: readonly QuoteEdge[]
}

export interface ExactInputQuote {
  readonly edgeId: string
  readonly amountIn: bigint
  readonly amountOut: bigint
  readonly gasEstimate: bigint
  readonly state: StateReference
  readonly evidenceLevel: EvidenceLevel
}

export interface QuoteAdapter {
  readonly id: string
  quoteExactInput(
    edge: QuoteEdge,
    amountIn: bigint,
    state: StateReference,
  ): Promise<ExactInputQuote>
}

export interface GasCostQuote {
  readonly totalGas: bigint
  readonly costInBaseAsset: bigint
  readonly state: StateReference
  readonly evidenceLevel: EvidenceLevel
}

export interface GasCostModel {
  estimateCostInBaseAsset(input: {
    readonly route: CycleRoute
    readonly totalGas: bigint
    readonly state: StateReference
  }): Promise<GasCostQuote>
}

export type EvaluationDisposition =
  'ELIGIBLE_SHADOW' | 'NO_SHOT_NEGATIVE_EV' | 'BLOCKED_CORRECTNESS'

export interface CycleEvaluation {
  readonly routeId: string
  readonly state: StateReference
  readonly amountIn: bigint
  readonly amountOut: bigint
  readonly hopQuotes: readonly ExactInputQuote[]
  readonly totalGas: bigint
  readonly gasCostInBaseAsset: bigint
  readonly riskBufferInBaseAsset: bigint
  readonly netProfitInBaseAsset: bigint
  readonly minimumNetProfitInBaseAsset: bigint
  readonly disposition: EvaluationDisposition
  readonly evidenceLevel: EvidenceLevel
}
