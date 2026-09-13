import assert from 'node:assert/strict'
import test from 'node:test'
import { getAddress } from 'viem'

import {
  routesForProfile,
  scanCrossVenueProfile,
  type CrossVenueProfile,
  type DirectQuote,
  type ShadowState,
} from '../src/shadow/cross-venue.js'
import { profileForNetwork } from '../src/shadow/profiles.js'
import {
  assertPublicShadowSnapshot,
  buildPublicShadowSnapshot,
} from '../src/shadow/public-snapshot.js'

const base = {
  symbol: 'WETH',
  address: getAddress('0x0000000000000000000000000000000000000001'),
  decimals: 18,
}
const target = {
  symbol: 'TEST',
  address: getAddress('0x0000000000000000000000000000000000000002'),
  decimals: 18,
}
const profile: CrossVenueProfile = {
  network: 'robinhood',
  chainId: 4663,
  baseAsset: base,
  targets: [target],
  venues: [
    {
      id: 'VENUE_A',
      label: 'Venue A',
      kind: 'V2_ROUTER',
      router: getAddress('0x0000000000000000000000000000000000000003'),
    },
    {
      id: 'VENUE_B',
      label: 'Venue B',
      kind: 'V2_ROUTER',
      router: getAddress('0x0000000000000000000000000000000000000004'),
    },
  ],
  amountsIn: [10_000n],
  conservativeGasUnits: 100n,
  riskBufferBps: 10n,
}
const state: ShadowState = {
  blockNumber: 123n,
  blockHash: `0x${'12'.repeat(32)}`,
  gasPrice: 1n,
}

const quote: DirectQuote = (input) => {
  const entering = input.tokenIn.address === base.address
  if (input.venue.id === 'VENUE_A') {
    return Promise.resolve({
      amountOut: entering ? input.amountIn * 2n : (input.amountIn * 49n) / 100n,
      feeTier: null,
    })
  }
  return Promise.resolve({
    amountOut: entering ? (input.amountIn * 19n) / 10n : (input.amountIn * 51n) / 100n,
    feeTier: null,
  })
}

void test('cross-venue shadow subtracts gas and risk without granting execution', async () => {
  const scan = await scanCrossVenueProfile({ profile, state, quote })
  assert.equal(scan.attemptedCycles, 2)
  assert.equal(scan.quoteCompleteCycles, 2)
  assert.equal(scan.positiveGrossCycles, 1)
  assert.equal(scan.positiveNetCycles, 1)
  const candidate = scan.candidates[0]
  assert.ok(candidate)
  assert.equal(candidate.entryVenue.id, 'VENUE_A')
  assert.equal(candidate.exitVenue.id, 'VENUE_B')
  assert.equal(candidate.grossProfit, 200n)
  assert.equal(candidate.estimatedGasCost, 100n)
  assert.equal(candidate.riskBuffer, 10n)
  assert.equal(candidate.estimatedNetProfit, 90n)
  assert.equal(candidate.disposition, 'SHADOW_POSITIVE_NOT_EXECUTABLE')

  const snapshot = buildPublicShadowSnapshot([
    {
      profile,
      observedAt: '2026-09-13T00:00:00.000Z',
      scan,
      quoteStats: {
        logicalQuotes: 4,
        rpcCalls: 4,
        failedRpcCalls: 0,
        unavailableQuotes: 0,
      },
      providerStats: {
        logicalRequests: 7,
        providerRequests: 8,
        transportFailures: 1,
        recoveredTransportRequests: 1,
      },
      reasonCode: 'NONE',
    },
  ])
  assert.doesNotThrow(() => assertPublicShadowSnapshot(snapshot))
  assert.equal(snapshot.signingEnabled, false)
  assert.equal(snapshot.broadcastEnabled, false)
  const network = snapshot.networks[0]
  assert.ok(network)
  assert.equal(network.funnel.executableCycles, 0)
  assert.equal(network.status, 'CURRENT')
  assert.deepEqual(network.readCost, {
    logicalQuotes: 4,
    logicalProviderRequests: 7,
    providerRequests: 8,
    failedProviderRequests: 1,
    recoveredTransportRequests: 1,
    unresolvedQuoteFailures: 0,
  })
  const bestObservedRoute = network.bestObservedRoutes[0]
  assert.ok(bestObservedRoute)
  assert.equal(bestObservedRoute.estimatedNetProfit, '0.00000000000000009 WETH')
})

void test('public shadow snapshot rejects wallet and signing material', () => {
  assert.throws(
    () =>
      assertPublicShadowSnapshot({
        schemaVersion: 1,
        mode: 'READ_ONLY_CROSS_VENUE_SHADOW',
        networks: [],
        walletAddress: '0xdead',
      }),
    /forbidden field/,
  )
})

void test('Robinhood route book combines direct DEX, Earn, and one-hop substitutions', () => {
  const routes = routesForProfile(profileForNetwork('robinhood'))
  assert.equal(routes.length, 80)
  assert.equal(
    routes.filter((route) =>
      route.steps.every((step) => step.venue.kind === 'BALANCER_V3_BATCH_ROUTER'),
    ).length,
    4,
  )
  assert.equal(
    routes.filter((route) => {
      const earnHops = route.steps.filter(
        (step) => step.venue.kind === 'BALANCER_V3_BATCH_ROUTER',
      ).length
      return earnHops > 0 && earnHops < route.steps.length
    }).length,
    40,
  )
  assert.equal(Math.max(...routes.map((route) => route.steps.length)), 3)
  for (const route of routes) {
    assert.equal(
      new Set(route.steps.map((step) => step.liquiditySourceId)).size,
      route.steps.length,
    )
  }
})

void test('BNB route book expands liquid assets and optimizes curated three-hop triangles', () => {
  const profile = profileForNetwork('bnb')
  const routes = routesForProfile(profile)
  assert.deepEqual(
    profile.targets.map((asset) => asset.symbol),
    ['USDT', 'USDC', 'FDUSD', 'CAKE', 'ETH', 'BTCB'],
  )
  assert.equal(routes.length, 80)
  assert.equal(routes.filter((route) => route.steps.length === 3).length, 8)
  assert.equal(
    routes.filter((route) => route.steps.some((step) => step.alternativeVenues?.length === 3))
      .length,
    8,
  )
})

void test('curated three-hop route is quoted sequentially with incremental gas', async () => {
  const middle = {
    symbol: 'MID',
    address: getAddress('0x0000000000000000000000000000000000000005'),
    decimals: 18,
  }
  const poolVenue = {
    id: 'EARN_POOL',
    label: 'Earn pool',
    kind: 'BALANCER_V3_BATCH_ROUTER' as const,
    router: getAddress('0x0000000000000000000000000000000000000006'),
    pool: getAddress('0x0000000000000000000000000000000000000007'),
  }
  const threeHopProfile: CrossVenueProfile = {
    ...profile,
    curatedRoutes: [
      {
        id: 'three-hop',
        probeGroupId: 'base>test>mid>base',
        executionReadiness: 'QUOTE_ONLY',
        steps: [
          {
            venue: profile.venues[0]!,
            alternativeVenues: [profile.venues[1]!],
            tokenIn: base,
            tokenOut: target,
            liquiditySourceId: 'a',
          },
          {
            venue: poolVenue,
            tokenIn: target,
            tokenOut: middle,
            liquiditySourceId: 'b',
          },
          {
            venue: profile.venues[0]!,
            alternativeVenues: [profile.venues[1]!],
            tokenIn: middle,
            tokenOut: base,
            liquiditySourceId: 'c',
          },
        ],
      },
    ],
    gasUnitsPerAdditionalHop: 50n,
  }
  const routeQuote: DirectQuote = (input) => {
    if (input.tokenIn.address === base.address && input.tokenOut.address === target.address) {
      return Promise.resolve({
        amountOut: input.amountIn * (input.venue.id === 'VENUE_B' ? 2n : 1n),
        feeTier: null,
      })
    }
    if (input.tokenIn.address === target.address && input.tokenOut.address === middle.address) {
      return Promise.resolve({ amountOut: input.amountIn * 2n, feeTier: null })
    }
    if (input.tokenIn.address === middle.address && input.tokenOut.address === base.address) {
      return Promise.resolve({
        amountOut: (input.amountIn * (input.venue.id === 'VENUE_B' ? 26n : 25n)) / 100n,
        feeTier: null,
      })
    }
    return Promise.resolve(null)
  }

  const scan = await scanCrossVenueProfile({ profile: threeHopProfile, state, quote: routeQuote })
  const candidate = scan.candidates.find((item) => item.routeId === 'three-hop')
  assert.ok(candidate)
  assert.equal(candidate.hopCount, 3)
  assert.equal(candidate.routeClass, 'HYBRID')
  assert.deepEqual(candidate.assetPath, ['WETH', 'TEST', 'MID', 'WETH'])
  assert.equal(candidate.routeSteps[0]?.venueId, 'VENUE_B')
  assert.equal(candidate.routeSteps[2]?.venueId, 'VENUE_B')
  assert.equal(candidate.grossProfit, 400n)
  assert.equal(candidate.estimatedGasUnits, 150n)
  assert.equal(candidate.estimatedNetProfit, 240n)
})

void test('public snapshot surfaces a gross-positive route when gas makes every route net-negative', async () => {
  const expensiveProfile: CrossVenueProfile = { ...profile, conservativeGasUnits: 1_000n }
  const scan = await scanCrossVenueProfile({ profile: expensiveProfile, state, quote })
  assert.equal(scan.positiveGrossCycles, 1)
  assert.equal(scan.positiveNetCycles, 0)
  const snapshot = buildPublicShadowSnapshot([
    {
      profile: expensiveProfile,
      observedAt: '2026-09-13T00:00:00.000Z',
      scan,
      quoteStats: {
        logicalQuotes: 4,
        rpcCalls: 4,
        failedRpcCalls: 0,
        unavailableQuotes: 0,
      },
      providerStats: {
        logicalRequests: 4,
        providerRequests: 4,
        transportFailures: 0,
        recoveredTransportRequests: 0,
      },
      reasonCode: 'NONE',
    },
  ])
  assert.match(
    snapshot.networks[0]?.bestObservedRoutes[0]?.grossProfit ?? '',
    /^0\.0000000000000002 /,
  )
  assert.match(snapshot.networks[0]?.bestObservedRoutes[0]?.estimatedNetProfit ?? '', /^-/)
})

void test('principal ladder stops at the first size with no gross-positive route', async () => {
  const ladderProfile: CrossVenueProfile = {
    ...profile,
    amountsIn: [100n, 200n, 300n],
    conservativeGasUnits: 1n,
    riskBufferBps: 0n,
  }
  const ladderQuote: DirectQuote = (input) => {
    if (input.venue.id === 'VENUE_A' && input.tokenIn.address === base.address) {
      return Promise.resolve({ amountOut: input.amountIn * 2n, feeTier: null })
    }
    if (input.venue.id === 'VENUE_B' && input.tokenOut.address === base.address) {
      const amountOut = input.amountIn === 200n ? 110n : input.amountIn === 400n ? 190n : 400n
      return Promise.resolve({ amountOut, feeTier: null })
    }
    return Promise.resolve(null)
  }

  const scan = await scanCrossVenueProfile({ profile: ladderProfile, state, quote: ladderQuote })
  assert.equal(scan.attemptedCycles, 4)
  assert.deepEqual(
    scan.candidates
      .map((candidate) => candidate.amountIn)
      .sort((left, right) => Number(left - right)),
    [100n, 200n],
  )
})
