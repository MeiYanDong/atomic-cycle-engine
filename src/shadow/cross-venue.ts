import type { Address, Hash } from 'viem'

import type { NetworkId } from '../config/registry.js'

export interface ShadowToken {
  readonly symbol: string
  readonly address: Address
  readonly decimals: number
}

export interface V2ShadowVenue {
  readonly id: string
  readonly label: string
  readonly kind: 'V2_ROUTER'
  readonly router: Address
}

export interface V3ShadowVenue {
  readonly id: string
  readonly label: string
  readonly kind: 'V3_QUOTER_V2'
  readonly factory: Address
  readonly quoter: Address
  readonly feeTiers: readonly number[]
}

export type ShadowVenue = V2ShadowVenue | V3ShadowVenue

export interface CrossVenueProfile {
  readonly network: NetworkId
  readonly chainId: number
  readonly baseAsset: ShadowToken
  readonly targets: readonly ShadowToken[]
  readonly venues: readonly ShadowVenue[]
  readonly amountsIn: readonly bigint[]
  readonly conservativeGasUnits: bigint
  readonly riskBufferBps: bigint
}

export interface ShadowState {
  readonly blockNumber: bigint
  readonly blockHash: Hash
  readonly gasPrice: bigint
}

export interface DirectQuoteInput {
  readonly venue: ShadowVenue
  readonly tokenIn: ShadowToken
  readonly tokenOut: ShadowToken
  readonly amountIn: bigint
  readonly blockNumber: bigint
}

export interface DirectQuoteResult {
  readonly amountOut: bigint
  readonly feeTier: number | null
}

export type DirectQuote = (input: DirectQuoteInput) => Promise<DirectQuoteResult | null>

export interface CrossVenueCandidate {
  readonly network: NetworkId
  readonly chainId: number
  readonly baseAsset: ShadowToken
  readonly target: ShadowToken
  readonly entryVenue: Pick<ShadowVenue, 'id' | 'label'>
  readonly exitVenue: Pick<ShadowVenue, 'id' | 'label'>
  readonly entryFeeTier: number | null
  readonly exitFeeTier: number | null
  readonly amountIn: bigint
  readonly amountOut: bigint
  readonly grossProfit: bigint
  readonly estimatedGasCost: bigint
  readonly riskBuffer: bigint
  readonly estimatedNetProfit: bigint
  readonly disposition: 'SHADOW_POSITIVE_NOT_EXECUTABLE' | 'SHADOW_NEGATIVE'
  readonly state: ShadowState
}

export interface CrossVenueScan {
  readonly network: NetworkId
  readonly state: ShadowState
  readonly attemptedCycles: number
  readonly quoteCompleteCycles: number
  readonly positiveGrossCycles: number
  readonly positiveNetCycles: number
  readonly candidates: readonly CrossVenueCandidate[]
}

function riskBuffer(amountIn: bigint, basisPoints: bigint): bigint {
  return (amountIn * basisPoints + 9_999n) / 10_000n
}

function compareCandidate(left: CrossVenueCandidate, right: CrossVenueCandidate): number {
  if (left.estimatedNetProfit !== right.estimatedNetProfit) {
    return left.estimatedNetProfit > right.estimatedNetProfit ? -1 : 1
  }
  if (left.grossProfit !== right.grossProfit) {
    return left.grossProfit > right.grossProfit ? -1 : 1
  }
  return left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0
}

export async function scanCrossVenueProfile(input: {
  readonly profile: CrossVenueProfile
  readonly state: ShadowState
  readonly quote: DirectQuote
}): Promise<CrossVenueScan> {
  const { profile, state, quote } = input
  if (profile.amountsIn.some((amount) => amount <= 0n)) {
    throw new RangeError('shadow scan amounts must be positive')
  }
  if (profile.conservativeGasUnits <= 0n || profile.riskBufferBps < 0n) {
    throw new RangeError('shadow cost policy is invalid')
  }
  if (profile.venues.length < 2) throw new Error('cross-venue scan requires at least two venues')

  const candidates: CrossVenueCandidate[] = []
  let attemptedCycles = 0
  const estimatedGasCost = state.gasPrice * profile.conservativeGasUnits

  for (const target of profile.targets) {
    const orderedAmounts = [...profile.amountsIn].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    )
    for (const [amountIndex, amountIn] of orderedAmounts.entries()) {
      const before = candidates.length
      attemptedCycles += profile.venues.length * (profile.venues.length - 1)
      const entryQuotes = await Promise.all(
        profile.venues.map(async (venue) => ({
          venue,
          quote: await quote({
            venue,
            tokenIn: profile.baseAsset,
            tokenOut: target,
            amountIn,
            blockNumber: state.blockNumber,
          }),
        })),
      )

      for (const entry of entryQuotes) {
        const entryQuote = entry.quote
        if (entryQuote === null || entryQuote.amountOut <= 0n) continue
        const exits = profile.venues.filter((venue) => venue.id !== entry.venue.id)
        const exitQuotes = await Promise.all(
          exits.map(async (venue) => ({
            venue,
            quote: await quote({
              venue,
              tokenIn: target,
              tokenOut: profile.baseAsset,
              amountIn: entryQuote.amountOut,
              blockNumber: state.blockNumber,
            }),
          })),
        )

        for (const exit of exitQuotes) {
          if (exit.quote === null || exit.quote.amountOut <= 0n) continue
          const grossProfit = exit.quote.amountOut - amountIn
          const buffer = riskBuffer(amountIn, profile.riskBufferBps)
          const estimatedNetProfit = grossProfit - estimatedGasCost - buffer
          candidates.push({
            network: profile.network,
            chainId: profile.chainId,
            baseAsset: profile.baseAsset,
            target,
            entryVenue: { id: entry.venue.id, label: entry.venue.label },
            exitVenue: { id: exit.venue.id, label: exit.venue.label },
            entryFeeTier: entryQuote.feeTier,
            exitFeeTier: exit.quote.feeTier,
            amountIn,
            amountOut: exit.quote.amountOut,
            grossProfit,
            estimatedGasCost,
            riskBuffer: buffer,
            estimatedNetProfit,
            disposition:
              estimatedNetProfit > 0n ? 'SHADOW_POSITIVE_NOT_EXECUTABLE' : 'SHADOW_NEGATIVE',
            state,
          })
        }
      }

      const amountCandidates = candidates.slice(before)
      if (amountIndex === 0 && !amountCandidates.some((candidate) => candidate.grossProfit > 0n)) {
        break
      }
    }
  }

  candidates.sort(compareCandidate)
  return {
    network: profile.network,
    state,
    attemptedCycles,
    quoteCompleteCycles: candidates.length,
    positiveGrossCycles: candidates.filter((candidate) => candidate.grossProfit > 0n).length,
    positiveNetCycles: candidates.filter((candidate) => candidate.estimatedNetProfit > 0n).length,
    candidates,
  }
}
