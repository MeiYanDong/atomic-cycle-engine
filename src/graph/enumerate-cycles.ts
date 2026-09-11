import { assetId, type AssetRef, type CycleRoute, type QuoteEdge } from '../domain/types.js'

export interface CycleEnumerationOptions {
  readonly minHops?: number
  readonly maxHops?: number
}

function assertHopBounds(minHops: number, maxHops: number): void {
  if (!Number.isInteger(minHops) || !Number.isInteger(maxHops)) {
    throw new TypeError('hop bounds must be integers')
  }
  if (minHops < 2 || maxHops > 4 || minHops > maxHops) {
    throw new RangeError('supported cycle length is 2 to 4 hops')
  }
}

function routeFrom(baseAsset: AssetRef, edges: readonly QuoteEdge[]): CycleRoute {
  return {
    id: edges.map((edge) => edge.id).join('>'),
    chainId: baseAsset.chainId,
    baseAsset,
    edges: [...edges],
  }
}

/** Enumerate deterministic simple cycles without reusing mutable liquidity. */
export function enumerateSimpleCycles(
  edges: readonly QuoteEdge[],
  baseAsset: AssetRef,
  options: CycleEnumerationOptions = {},
): CycleRoute[] {
  const minHops = options.minHops ?? 2
  const maxHops = options.maxHops ?? 4
  assertHopBounds(minHops, maxHops)

  const baseId = assetId(baseAsset)
  const adjacency = new Map<string, QuoteEdge[]>()
  const edgeIds = new Set<string>()

  for (const edge of edges) {
    if (edge.chainId !== baseAsset.chainId) continue
    if (edge.tokenIn.chainId !== edge.chainId || edge.tokenOut.chainId !== edge.chainId) {
      throw new Error(`edge contains cross-chain assets: ${edge.id}`)
    }
    if (assetId(edge.tokenIn) === assetId(edge.tokenOut)) {
      throw new Error(`self-loop edge is not a swap: ${edge.id}`)
    }
    if (edgeIds.has(edge.id)) throw new Error(`duplicate edge id: ${edge.id}`)
    edgeIds.add(edge.id)

    const key = assetId(edge.tokenIn)
    const group = adjacency.get(key) ?? []
    group.push(edge)
    adjacency.set(key, group)
  }

  for (const group of adjacency.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id))
  }

  const routes: CycleRoute[] = []
  const routeIds = new Set<string>()

  const visit = (
    currentAssetId: string,
    path: QuoteEdge[],
    visitedAssets: Set<string>,
    usedLiquidity: Set<string>,
  ): void => {
    if (path.length >= maxHops) return

    for (const edge of adjacency.get(currentAssetId) ?? []) {
      if (usedLiquidity.has(edge.liquiditySourceId)) continue

      const nextAssetId = assetId(edge.tokenOut)
      const nextPath = [...path, edge]

      if (nextAssetId === baseId) {
        if (nextPath.length < minHops) continue
        const route = routeFrom(baseAsset, nextPath)
        if (!routeIds.has(route.id)) {
          routeIds.add(route.id)
          routes.push(route)
        }
        continue
      }

      if (visitedAssets.has(nextAssetId) || nextPath.length >= maxHops) continue

      visit(
        nextAssetId,
        nextPath,
        new Set([...visitedAssets, nextAssetId]),
        new Set([...usedLiquidity, edge.liquiditySourceId]),
      )
    }
  }

  visit(baseId, [], new Set([baseId]), new Set())
  return routes.sort((left, right) => left.id.localeCompare(right.id))
}
