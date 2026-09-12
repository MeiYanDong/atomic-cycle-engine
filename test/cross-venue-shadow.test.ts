import assert from 'node:assert/strict'
import test from 'node:test'
import { getAddress } from 'viem'

import {
  scanCrossVenueProfile,
  type CrossVenueProfile,
  type DirectQuote,
  type ShadowState,
} from '../src/shadow/cross-venue.js'
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
      reasonCode: 'NONE',
    },
  ])
  assert.doesNotThrow(() => assertPublicShadowSnapshot(snapshot))
  assert.equal(snapshot.signingEnabled, false)
  assert.equal(snapshot.broadcastEnabled, false)
  const network = snapshot.networks[0]
  assert.ok(network)
  assert.equal(network.funnel.executableCycles, 0)
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
