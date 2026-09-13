import { getAddress, parseUnits } from 'viem'

import { CONTRACTS, NETWORKS, type ContractDefinition } from '../config/registry.js'
import type {
  CrossVenueProfile,
  ShadowRoute,
  ShadowRouteStep,
  ShadowToken,
  ShadowVenue,
} from './cross-venue.js'

function contract(id: string): ContractDefinition {
  const match = CONTRACTS.find((definition) => definition.id === id)
  if (match === undefined) throw new Error(`missing shadow contract definition: ${id}`)
  return match
}

function token(symbol: string, value: string, decimals: number): ShadowToken {
  return { symbol, address: getAddress(value), decimals }
}

function v2(id: string, label: string, routerId: string): ShadowVenue {
  return { id, label, kind: 'V2_ROUTER', router: contract(routerId).address }
}

function v3(
  id: string,
  label: string,
  factoryId: string,
  quoterId: string,
  feeTiers: readonly number[],
): ShadowVenue {
  return {
    id,
    label,
    kind: 'V3_QUOTER_V2',
    factory: contract(factoryId).address,
    quoter: contract(quoterId).address,
    feeTiers,
  }
}

function balancerV3Pool(id: string, label: string, routerId: string, poolId: string): ShadowVenue {
  return {
    id,
    label,
    kind: 'BALANCER_V3_BATCH_ROUTER',
    router: contract(routerId).address,
    pool: contract(poolId).address,
  }
}

function sourceId(venue: ShadowVenue, tokenIn: ShadowToken, tokenOut: ShadowToken): string {
  if (venue.kind === 'BALANCER_V3_BATCH_ROUTER') {
    return `BALANCER_V3:${venue.pool.toLowerCase()}`
  }
  return `${venue.id}:${[tokenIn.address.toLowerCase(), tokenOut.address.toLowerCase()].sort().join(':')}`
}

function step(venue: ShadowVenue, tokenIn: ShadowToken, tokenOut: ShadowToken): ShadowRouteStep {
  return { venue, tokenIn, tokenOut, liquiditySourceId: sourceId(venue, tokenIn, tokenOut) }
}

function optimizedStep(
  venues: readonly ShadowVenue[],
  tokenIn: ShadowToken,
  tokenOut: ShadowToken,
): ShadowRouteStep {
  const [venue, ...alternativeVenues] = venues
  if (venue === undefined) throw new Error('optimized shadow step requires at least one venue')
  return { ...step(venue, tokenIn, tokenOut), alternativeVenues }
}

function route(
  id: string,
  steps: readonly ShadowRouteStep[],
  executionReadiness: ShadowRoute['executionReadiness'],
): ShadowRoute {
  const assets = [steps[0]?.tokenIn.address, ...steps.map((item) => item.tokenOut.address)]
  return {
    id,
    probeGroupId: assets.map((address) => address?.toLowerCase()).join('>'),
    steps,
    executionReadiness,
  }
}

function withSingleDexSubstitutions(
  routes: readonly ShadowRoute[],
  dexVenues: readonly ShadowVenue[],
): ShadowRoute[] {
  return routes.flatMap((original) => [
    original,
    ...original.steps.flatMap((originalStep, stepIndex) =>
      dexVenues.map((venue) =>
        route(
          `${original.id}:DEX_HOP_${stepIndex + 1}:${venue.id}`,
          original.steps.map((item, index) =>
            index === stepIndex ? step(venue, item.tokenIn, item.tokenOut) : item,
          ),
          'QUOTE_ONLY',
        ),
      ),
    ),
  ])
}

const ROBINHOOD_WETH = token('WETH', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', 18)
const ROBINHOOD_USDG = token('USDG', '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', 6)
const ROBINHOOD_AI = token('AI', '0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18', 18)
const ROBINHOOD_MOO = token('MOO', '0xD9dB30BB0D2b8d2eae3826A1372117E058791e18', 18)
const BNB_WBNB = token('WBNB', '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 18)
const BNB_USDT = token('USDT', '0x55d398326f99059fF775485246999027B3197955', 18)
const BNB_USDC = token('USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18)
const BNB_FDUSD = token('FDUSD', '0xc5f0f7B66764F6EC8C8Dff7ba683102295E16409', 18)
const BNB_CAKE = token('CAKE', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', 18)
const BNB_ETH = token('ETH', '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', 18)
const BNB_BTCB = token('BTCB', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', 18)

const ROBINHOOD_DEX_VENUES: readonly ShadowVenue[] = [
  v2('UNISWAP_V2', 'Uniswap V2', 'robinhood.uniswap-v2.router'),
  v2('PANCAKESWAP_V2', 'PancakeSwap V2', 'robinhood.pancakeswap-v2.router'),
  v3(
    'UNISWAP_V3',
    'Uniswap V3',
    'robinhood.uniswap-v3.factory',
    'robinhood.uniswap-v3.quoter',
    [100, 500, 3_000, 10_000],
  ),
  v3(
    'PANCAKESWAP_V3',
    'PancakeSwap V3',
    'robinhood.pancakeswap-v3.factory',
    'robinhood.pancakeswap-v3.quoter-v2',
    [100, 500, 2_500, 10_000],
  ),
]

const EARN_HOOD = balancerV3Pool(
  'EARN_HOOD_ECOSYSTEM',
  'Earn · Hood 生态池',
  'robinhood.earn.batch-router',
  'robinhood.earn.hood-ecosystem-pool',
)
const EARN_STOCK = balancerV3Pool(
  'EARN_STOCK_MEMES',
  'Earn · 股票与 Meme 池',
  'robinhood.earn.batch-router',
  'robinhood.earn.stock-memes-pool',
)
const EARN_LONG = balancerV3Pool(
  'EARN_LONG_ECO',
  'Earn · Long 生态池',
  'robinhood.earn.batch-router',
  'robinhood.earn.long-eco-pool',
)

const ROBINHOOD_EARN_ROUTES: readonly ShadowRoute[] = [
  route(
    'EARN:WETH_AI_WETH:STOCK_LONG',
    [step(EARN_STOCK, ROBINHOOD_WETH, ROBINHOOD_AI), step(EARN_LONG, ROBINHOOD_AI, ROBINHOOD_WETH)],
    'SEPARATE_TYPED_EXECUTOR',
  ),
  route(
    'EARN:WETH_AI_WETH:LONG_STOCK',
    [step(EARN_LONG, ROBINHOOD_WETH, ROBINHOOD_AI), step(EARN_STOCK, ROBINHOOD_AI, ROBINHOOD_WETH)],
    'SEPARATE_TYPED_EXECUTOR',
  ),
  route(
    'EARN:WETH_AI_MOO_WETH',
    [
      step(EARN_HOOD, ROBINHOOD_WETH, ROBINHOOD_AI),
      step(EARN_STOCK, ROBINHOOD_AI, ROBINHOOD_MOO),
      step(EARN_LONG, ROBINHOOD_MOO, ROBINHOOD_WETH),
    ],
    'SEPARATE_TYPED_EXECUTOR',
  ),
  route(
    'EARN:WETH_MOO_AI_WETH',
    [
      step(EARN_LONG, ROBINHOOD_WETH, ROBINHOOD_MOO),
      step(EARN_STOCK, ROBINHOOD_MOO, ROBINHOOD_AI),
      step(EARN_HOOD, ROBINHOOD_AI, ROBINHOOD_WETH),
    ],
    'SEPARATE_TYPED_EXECUTOR',
  ),
]

const BNB_DEX_VENUES: readonly ShadowVenue[] = [
  v2('PANCAKESWAP_V2', 'PancakeSwap V2', 'bnb.pancakeswap-v2.router'),
  v2('UNISWAP_V2', 'Uniswap V2', 'bnb.uniswap-v2.router'),
  v3(
    'PANCAKESWAP_V3',
    'PancakeSwap V3',
    'bnb.pancakeswap-v3.factory',
    'bnb.pancakeswap-v3.quoter-v2',
    [100, 500, 2_500, 10_000],
  ),
  v3(
    'UNISWAP_V3',
    'Uniswap V3',
    'bnb.uniswap-v3.factory',
    'bnb.uniswap-v3.quoter-v2',
    [100, 500, 3_000, 10_000],
  ),
]

function optimizedTriangle(id: string, first: ShadowToken, second: ShadowToken): ShadowRoute {
  return route(
    `BNB_TRIANGLE:${id}`,
    [
      optimizedStep(BNB_DEX_VENUES, BNB_WBNB, first),
      optimizedStep(BNB_DEX_VENUES, first, second),
      optimizedStep(BNB_DEX_VENUES, second, BNB_WBNB),
    ],
    'QUOTE_ONLY',
  )
}

const BNB_CURATED_TRIANGLES: readonly ShadowRoute[] = [
  optimizedTriangle('USDT_CAKE', BNB_USDT, BNB_CAKE),
  optimizedTriangle('CAKE_USDT', BNB_CAKE, BNB_USDT),
  optimizedTriangle('USDT_ETH', BNB_USDT, BNB_ETH),
  optimizedTriangle('ETH_USDT', BNB_ETH, BNB_USDT),
  optimizedTriangle('USDT_BTCB', BNB_USDT, BNB_BTCB),
  optimizedTriangle('BTCB_USDT', BNB_BTCB, BNB_USDT),
  optimizedTriangle('USDT_USDC', BNB_USDT, BNB_USDC),
  optimizedTriangle('USDC_USDT', BNB_USDC, BNB_USDT),
]

export const CROSS_VENUE_PROFILES: readonly CrossVenueProfile[] = [
  {
    network: 'robinhood',
    chainId: NETWORKS.robinhood.chainId,
    baseAsset: ROBINHOOD_WETH,
    targets: [ROBINHOOD_USDG, ROBINHOOD_AI, ROBINHOOD_MOO],
    venues: ROBINHOOD_DEX_VENUES,
    curatedRoutes: withSingleDexSubstitutions(ROBINHOOD_EARN_ROUTES, ROBINHOOD_DEX_VENUES),
    amountsIn: [
      parseUnits('0.0005', 18),
      parseUnits('0.002', 18),
      parseUnits('0.008', 18),
      parseUnits('0.032', 18),
      parseUnits('0.128', 18),
    ],
    conservativeGasUnits: 600_000n,
    gasUnitsPerAdditionalHop: 200_000n,
    riskBufferBps: 10n,
  },
  {
    network: 'bnb',
    chainId: NETWORKS.bnb.chainId,
    baseAsset: BNB_WBNB,
    targets: [BNB_USDT, BNB_USDC, BNB_FDUSD, BNB_CAKE, BNB_ETH, BNB_BTCB],
    venues: BNB_DEX_VENUES,
    curatedRoutes: BNB_CURATED_TRIANGLES,
    amountsIn: [
      parseUnits('0.0025', 18),
      parseUnits('0.01', 18),
      parseUnits('0.04', 18),
      parseUnits('0.16', 18),
      parseUnits('0.64', 18),
    ],
    conservativeGasUnits: 600_000n,
    gasUnitsPerAdditionalHop: 200_000n,
    riskBufferBps: 10n,
  },
]

export function profileForNetwork(network: 'robinhood' | 'bnb'): CrossVenueProfile {
  const profile = CROSS_VENUE_PROFILES.find((candidate) => candidate.network === network)
  if (profile === undefined) throw new Error(`missing cross-venue profile: ${network}`)
  return profile
}
