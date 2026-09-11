import {
  sameState,
  type CycleEvaluation,
  type CycleRoute,
  type EvidenceLevel,
  type GasCostModel,
  type QuoteAdapter,
  type StateReference,
} from '../domain/types.js'

export interface EvaluationPolicy {
  readonly minimumNetProfitInBaseAsset: bigint
  readonly riskBufferInBaseAsset: bigint
}

function weakestEvidence(levels: readonly EvidenceLevel[]): EvidenceLevel {
  const order: readonly EvidenceLevel[] = [
    'configured',
    'repository_record',
    'live_observed',
    'receipt_attested',
    'economic_reconciled',
  ]
  return levels.reduce((weakest, current) =>
    order.indexOf(current) < order.indexOf(weakest) ? current : weakest,
  )
}

function assertRouteShape(route: CycleRoute): void {
  if (route.edges.length < 2 || route.edges.length > 4) {
    throw new Error('cycle must contain 2 to 4 hops')
  }
  if (route.edges[0]?.tokenIn.address.toLowerCase() !== route.baseAsset.address.toLowerCase()) {
    throw new Error('cycle does not start in the declared base asset')
  }
  if (
    route.baseAsset.chainId !== route.chainId ||
    route.edges.some(
      (edge) =>
        edge.chainId !== route.chainId ||
        edge.tokenIn.chainId !== route.chainId ||
        edge.tokenOut.chainId !== route.chainId,
    )
  ) {
    throw new Error('cycle contains a cross-chain edge or asset')
  }
  for (let index = 1; index < route.edges.length; index += 1) {
    const previous = route.edges[index - 1]
    const current = route.edges[index]
    if (previous === undefined || current === undefined) throw new Error('invalid route edge')
    if (previous.tokenOut.address.toLowerCase() !== current.tokenIn.address.toLowerCase()) {
      throw new Error(`route discontinuity before edge ${current.id}`)
    }
  }
  const last = route.edges.at(-1)
  if (last?.tokenOut.address.toLowerCase() !== route.baseAsset.address.toLowerCase()) {
    throw new Error('cycle does not settle in the declared base asset')
  }
}

export async function evaluateCycle(input: {
  readonly route: CycleRoute
  readonly amountIn: bigint
  readonly state: StateReference
  readonly adapters: ReadonlyMap<string, QuoteAdapter>
  readonly gasCostModel: GasCostModel
  readonly policy: EvaluationPolicy
}): Promise<CycleEvaluation> {
  assertRouteShape(input.route)
  if (input.amountIn <= 0n) throw new RangeError('amountIn must be positive')
  if (input.route.chainId !== input.state.chainId) throw new Error('route and state chain mismatch')
  if (input.policy.minimumNetProfitInBaseAsset < 0n || input.policy.riskBufferInBaseAsset < 0n) {
    throw new RangeError('profit floor and risk buffer cannot be negative')
  }

  let rollingAmount = input.amountIn
  let totalGas = 0n
  const hopQuotes = []

  for (const edge of input.route.edges) {
    const adapter = input.adapters.get(edge.adapterId)
    if (adapter === undefined) throw new Error(`missing quote adapter: ${edge.adapterId}`)
    const quote = await adapter.quoteExactInput(edge, rollingAmount, input.state)
    if (quote.edgeId !== edge.id) throw new Error(`quote edge mismatch: ${edge.id}`)
    if (quote.amountIn !== rollingAmount) throw new Error(`quote amount mismatch: ${edge.id}`)
    if (!sameState(quote.state, input.state)) throw new Error(`mixed-state quote: ${edge.id}`)
    if (quote.amountOut < 0n || quote.gasEstimate < 0n)
      throw new Error(`negative quote value: ${edge.id}`)

    hopQuotes.push(quote)
    rollingAmount = quote.amountOut
    totalGas += quote.gasEstimate
  }

  const gas = await input.gasCostModel.estimateCostInBaseAsset({
    route: input.route,
    totalGas,
    state: input.state,
  })
  if (!sameState(gas.state, input.state)) throw new Error('mixed-state gas conversion')
  if (gas.totalGas !== totalGas) throw new Error('gas model changed the quoted gas total')
  if (gas.costInBaseAsset < 0n) throw new Error('negative gas cost')

  const netProfit =
    rollingAmount - input.amountIn - gas.costInBaseAsset - input.policy.riskBufferInBaseAsset
  const evidenceLevel = weakestEvidence([
    ...hopQuotes.map((quote) => quote.evidenceLevel),
    gas.evidenceLevel,
  ])

  return {
    routeId: input.route.id,
    state: input.state,
    amountIn: input.amountIn,
    amountOut: rollingAmount,
    hopQuotes,
    totalGas,
    gasCostInBaseAsset: gas.costInBaseAsset,
    riskBufferInBaseAsset: input.policy.riskBufferInBaseAsset,
    netProfitInBaseAsset: netProfit,
    minimumNetProfitInBaseAsset: input.policy.minimumNetProfitInBaseAsset,
    disposition:
      netProfit >= input.policy.minimumNetProfitInBaseAsset
        ? 'ELIGIBLE_SHADOW'
        : 'NO_SHOT_NEGATIVE_EV',
    evidenceLevel,
  }
}

export function selectBestAmount(
  evaluations: readonly CycleEvaluation[],
): CycleEvaluation | undefined {
  return [...evaluations].sort((left, right) => {
    if (left.netProfitInBaseAsset === right.netProfitInBaseAsset) {
      return left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0
    }
    return left.netProfitInBaseAsset > right.netProfitInBaseAsset ? -1 : 1
  })[0]
}
