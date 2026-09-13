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

export interface BalancerV3PoolShadowVenue {
  readonly id: string
  readonly label: string
  readonly kind: 'BALANCER_V3_BATCH_ROUTER'
  readonly router: Address
  readonly pool: Address
}

export type ShadowVenue = V2ShadowVenue | V3ShadowVenue | BalancerV3PoolShadowVenue

export type ShadowExecutionReadiness = 'QUOTE_ONLY' | 'SEPARATE_TYPED_EXECUTOR'

export interface ShadowRouteStep {
  readonly venue: ShadowVenue
  /** Ordered quote alternatives. The scanner selects the best exact output at the fixed block. */
  readonly alternativeVenues?: readonly ShadowVenue[]
  readonly tokenIn: ShadowToken
  readonly tokenOut: ShadowToken
  /** A pool or other mutable inventory identity. One route may not reuse it. */
  readonly liquiditySourceId: string
}

export interface ShadowRoute {
  readonly id: string
  /** Routes in one group share an asset path and therefore one staged sizing decision. */
  readonly probeGroupId: string
  readonly steps: readonly ShadowRouteStep[]
  readonly executionReadiness: ShadowExecutionReadiness
}

export interface CrossVenueProfile {
  readonly network: NetworkId
  readonly chainId: number
  readonly baseAsset: ShadowToken
  readonly targets: readonly ShadowToken[]
  readonly venues: readonly ShadowVenue[]
  readonly curatedRoutes?: readonly ShadowRoute[]
  readonly amountsIn: readonly bigint[]
  readonly conservativeGasUnits: bigint
  readonly gasUnitsPerAdditionalHop?: bigint
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
  readonly routeId: string
  readonly assetPath: readonly string[]
  readonly routeSteps: readonly {
    readonly venueId: string
    readonly venueLabel: string
    readonly feeTier: number | null
  }[]
  readonly hopCount: number
  readonly routeClass: 'DEX_ONLY' | 'EARN_ONLY' | 'HYBRID'
  readonly executionReadiness: ShadowExecutionReadiness
  readonly entryVenue: Pick<ShadowVenue, 'id' | 'label'>
  readonly exitVenue: Pick<ShadowVenue, 'id' | 'label'>
  readonly entryFeeTier: number | null
  readonly exitFeeTier: number | null
  readonly amountIn: bigint
  readonly amountOut: bigint
  readonly grossProfit: bigint
  readonly estimatedGasCost: bigint
  readonly estimatedGasUnits: bigint
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

function pairSourceId(venue: ShadowVenue, left: ShadowToken, right: ShadowToken): string {
  if (venue.kind === 'BALANCER_V3_BATCH_ROUTER') {
    return `BALANCER_V3:${venue.pool.toLowerCase()}`
  }
  const tokens = [left.address.toLowerCase(), right.address.toLowerCase()].sort()
  return `${venue.id}:${tokens.join(':')}`
}

function directRoutes(profile: CrossVenueProfile): ShadowRoute[] {
  return profile.targets.flatMap((target) =>
    profile.venues.flatMap((entryVenue) =>
      profile.venues
        .filter((exitVenue) => exitVenue.id !== entryVenue.id)
        .map((exitVenue) => ({
          id: `${profile.network}:${entryVenue.id}:${profile.baseAsset.symbol}-${target.symbol}:${exitVenue.id}`,
          probeGroupId: `${profile.baseAsset.address.toLowerCase()}>${target.address.toLowerCase()}>${profile.baseAsset.address.toLowerCase()}`,
          steps: [
            {
              venue: entryVenue,
              tokenIn: profile.baseAsset,
              tokenOut: target,
              liquiditySourceId: pairSourceId(entryVenue, profile.baseAsset, target),
            },
            {
              venue: exitVenue,
              tokenIn: target,
              tokenOut: profile.baseAsset,
              liquiditySourceId: pairSourceId(exitVenue, target, profile.baseAsset),
            },
          ],
          executionReadiness: 'QUOTE_ONLY' as const,
        })),
    ),
  )
}

function assertRoute(profile: CrossVenueProfile, route: ShadowRoute): void {
  if (route.steps.length < 2 || route.steps.length > 4) {
    throw new Error(`shadow route must contain 2 to 4 hops: ${route.id}`)
  }
  const first = route.steps[0]
  const last = route.steps.at(-1)
  if (
    first?.tokenIn.address.toLowerCase() !== profile.baseAsset.address.toLowerCase() ||
    last?.tokenOut.address.toLowerCase() !== profile.baseAsset.address.toLowerCase()
  ) {
    throw new Error(`shadow route must start and settle in the base asset: ${route.id}`)
  }
  const sources = new Set<string>()
  route.steps.forEach((step, index) => {
    const previous = route.steps[index - 1]
    if (
      previous !== undefined &&
      previous.tokenOut.address.toLowerCase() !== step.tokenIn.address.toLowerCase()
    ) {
      throw new Error(`shadow route is discontinuous: ${route.id}`)
    }
    if (step.tokenIn.address.toLowerCase() === step.tokenOut.address.toLowerCase()) {
      throw new Error(`shadow route contains a self swap: ${route.id}`)
    }
    if ((step.alternativeVenues?.length ?? 0) === 0 && sources.has(step.liquiditySourceId)) {
      throw new Error(`shadow route reuses mutable liquidity: ${route.id}`)
    }
    if ((step.alternativeVenues?.length ?? 0) === 0) sources.add(step.liquiditySourceId)
  })
}

export function routesForProfile(profile: CrossVenueProfile): readonly ShadowRoute[] {
  const routes = [...directRoutes(profile), ...(profile.curatedRoutes ?? [])]
  const ids = new Set<string>()
  for (const route of routes) {
    if (ids.has(route.id)) throw new Error(`duplicate shadow route id: ${route.id}`)
    ids.add(route.id)
    assertRoute(profile, route)
  }
  return routes.sort((left, right) => left.id.localeCompare(right.id))
}

function routeClass(venues: readonly ShadowVenue[]): CrossVenueCandidate['routeClass'] {
  const earnHops = venues.filter((venue) => venue.kind === 'BALANCER_V3_BATCH_ROUTER').length
  if (earnHops === 0) return 'DEX_ONLY'
  return earnHops === venues.length ? 'EARN_ONLY' : 'HYBRID'
}

async function quoteRoute(input: {
  readonly route: ShadowRoute
  readonly amountIn: bigint
  readonly blockNumber: bigint
  readonly quote: DirectQuote
}): Promise<{
  readonly amountOut: bigint
  readonly steps: readonly {
    readonly venue: ShadowVenue
    readonly quote: DirectQuoteResult
  }[]
} | null> {
  let rollingAmount = input.amountIn
  const steps: { venue: ShadowVenue; quote: DirectQuoteResult }[] = []
  const usedLiquidity = new Set<string>()
  for (const step of input.route.steps) {
    const choices = [step.venue, ...(step.alternativeVenues ?? [])].filter(
      (venue, index, venues) =>
        venues.findIndex((candidate) => candidate.id === venue.id) === index,
    )
    const results = await Promise.all(
      choices.map(async (venue) => {
        const source = pairSourceId(venue, step.tokenIn, step.tokenOut)
        if (usedLiquidity.has(source)) return null
        const quote = await input.quote({
          venue,
          tokenIn: step.tokenIn,
          tokenOut: step.tokenOut,
          amountIn: rollingAmount,
          blockNumber: input.blockNumber,
        })
        return quote === null || quote.amountOut <= 0n ? null : { venue, source, quote }
      }),
    )
    const selected = results.reduce<NonNullable<(typeof results)[number]> | null>(
      (best, current) =>
        current !== null && (best === null || current.quote.amountOut > best.quote.amountOut)
          ? current
          : best,
      null,
    )
    if (selected === null) return null
    usedLiquidity.add(selected.source)
    steps.push({ venue: selected.venue, quote: selected.quote })
    rollingAmount = selected.quote.amountOut
  }
  return { amountOut: rollingAmount, steps }
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
  if ((profile.gasUnitsPerAdditionalHop ?? 0n) < 0n) {
    throw new RangeError('shadow incremental gas policy is invalid')
  }
  if (profile.venues.length < 2) throw new Error('cross-venue scan requires at least two venues')

  const candidates: CrossVenueCandidate[] = []
  let attemptedCycles = 0
  const routeGroups = new Map<string, ShadowRoute[]>()
  for (const route of routesForProfile(profile)) {
    const group = routeGroups.get(route.probeGroupId) ?? []
    group.push(route)
    routeGroups.set(route.probeGroupId, group)
  }

  for (const routes of routeGroups.values()) {
    const orderedAmounts = [...profile.amountsIn].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    )
    for (const amountIn of orderedAmounts) {
      const before = candidates.length
      attemptedCycles += routes.length
      const quotedRoutes = await Promise.all(
        routes.map(async (route) => ({
          route,
          result: await quoteRoute({ route, amountIn, blockNumber: state.blockNumber, quote }),
        })),
      )

      for (const { route, result } of quotedRoutes) {
        if (result === null) continue
        const first = route.steps[0]
        const last = route.steps.at(-1)
        const firstQuoted = result.steps[0]
        const lastQuoted = result.steps.at(-1)
        const target = first?.tokenOut
        if (
          first === undefined ||
          last === undefined ||
          firstQuoted === undefined ||
          lastQuoted === undefined ||
          target === undefined
        )
          continue
        const grossProfit = result.amountOut - amountIn
        const estimatedGasUnits =
          profile.conservativeGasUnits +
          BigInt(route.steps.length - 2) * (profile.gasUnitsPerAdditionalHop ?? 0n)
        const estimatedGasCost = state.gasPrice * estimatedGasUnits
        const buffer = riskBuffer(amountIn, profile.riskBufferBps)
        const estimatedNetProfit = grossProfit - estimatedGasCost - buffer
        candidates.push({
          network: profile.network,
          chainId: profile.chainId,
          baseAsset: profile.baseAsset,
          target,
          routeId: route.id,
          assetPath: [profile.baseAsset.symbol, ...route.steps.map((step) => step.tokenOut.symbol)],
          routeSteps: route.steps.map((step, index) => ({
            venueId: result.steps[index]?.venue.id ?? step.venue.id,
            venueLabel: result.steps[index]?.venue.label ?? step.venue.label,
            feeTier: result.steps[index]?.quote.feeTier ?? null,
          })),
          hopCount: route.steps.length,
          routeClass: routeClass(result.steps.map((step) => step.venue)),
          executionReadiness: route.executionReadiness,
          entryVenue: { id: firstQuoted.venue.id, label: firstQuoted.venue.label },
          exitVenue: { id: lastQuoted.venue.id, label: lastQuoted.venue.label },
          entryFeeTier: firstQuoted.quote.feeTier,
          exitFeeTier: lastQuoted.quote.feeTier,
          amountIn,
          amountOut: result.amountOut,
          grossProfit,
          estimatedGasCost,
          estimatedGasUnits,
          riskBuffer: buffer,
          estimatedNetProfit,
          disposition:
            estimatedNetProfit > 0n ? 'SHADOW_POSITIVE_NOT_EXECUTABLE' : 'SHADOW_NEGATIVE',
          state,
        })
      }

      const amountCandidates = candidates.slice(before)
      if (!amountCandidates.some((candidate) => candidate.grossProfit > 0n)) {
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
