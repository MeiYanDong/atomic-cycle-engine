import assert from 'node:assert/strict'
import test from 'node:test'

import { assessCoverage, buildOpportunityFunnel } from '../src/census/funnel.js'
import { assertRegistry, CONTRACTS } from '../src/config/registry.js'
import { assertSourceProvenance, type SourceProvenance } from '../src/domain/types.js'

void test('funnel separates not observed, guard exits, unknown, and confirmed race loss', () => {
  const funnel = buildOpportunityFunnel({
    chainwideCandidateIds: ['a', 'b', 'c', 'd', 'e'],
    observations: [
      { candidateId: 'a', outcome: 'WON' },
      { candidateId: 'b', outcome: 'CONFIRMED_LOST_RACE' },
      { candidateId: 'c', outcome: 'LOW_VALUE_GUARD_EXIT' },
      { candidateId: 'd', outcome: 'UNKNOWN' },
    ],
  })

  assert.equal(funnel.counts.NOT_OBSERVED, 1)
  assert.deepEqual(funnel.observationRate, { numerator: 4, denominator: 5 })
  assert.deepEqual(funnel.raceWinRate, { numerator: 1, denominator: 2 })
  assert.equal(funnel.unknown, 1)
})

void test('coverage watermark fails closed on gaps before reporting complete', () => {
  assert.equal(
    assessCoverage({
      requiredFromBlock: 100n,
      observedThroughBlock: 200n,
      canonicalHead: 202n,
      confirmationDepth: 2n,
      gaps: [{ fromBlock: 150n, toBlock: 151n }],
    }).status,
    'GAPPED',
  )
  assert.equal(
    assessCoverage({
      requiredFromBlock: 100n,
      observedThroughBlock: 200n,
      canonicalHead: 202n,
      confirmationDepth: 2n,
      gaps: [],
    }).status,
    'COMPLETE',
  )
})

void test('NINECAT-style attribution keeps platform, protocol, and venue independent', () => {
  const attribution: SourceProvenance = {
    discoverySource: {
      id: 'ROBINHOOD_CHAIN_LOG',
      status: 'CHAIN_ATTESTED',
      evidenceRefs: ['tx:launch'],
    },
    launchPlatform: {
      id: 'LONG_ROUTE',
      status: 'CHAIN_ATTESTED',
      evidenceRefs: ['tx:launch'],
    },
    launchProtocol: {
      id: 'DOPPLER',
      status: 'CHAIN_ATTESTED',
      evidenceRefs: ['receipt:airlock'],
    },
    liquidityVenue: {
      id: 'UNISWAP_V4',
      status: 'CHAIN_ATTESTED',
      evidenceRefs: ['pool-manager:initialize'],
    },
  }
  assert.doesNotThrow(() => assertSourceProvenance(attribution))
  assert.notEqual(attribution.launchPlatform.id, 'PAIR')
  assert.notEqual(attribution.launchPlatform.id, attribution.liquidityVenue.id)
})

void test('registry identities are unique and platform contracts do not become venues', () => {
  assert.doesNotThrow(assertRegistry)
  const pairHook = CONTRACTS.find((contract) => contract.id === 'robinhood.pair.hook')
  assert.ok(pairHook)
  assert.equal(pairHook.platformId, 'PAIR')
  assert.equal(pairHook.venueId, 'UNISWAP_V4')
  assert.equal(pairHook.support, 'DISCOVERY_ONLY')

  const robinhoodVenues = new Set(
    CONTRACTS.filter(
      (contract) => contract.network === 'robinhood' && contract.role === 'POOL_FACTORY',
    ).map((contract) => contract.venueId),
  )
  assert.ok(robinhoodVenues.has('UNISWAP_V2'))
  assert.ok(robinhoodVenues.has('PANCAKESWAP_V2'))
  assert.ok(robinhoodVenues.has('PANCAKESWAP_V3'))

  const bnbContracts = CONTRACTS.filter((contract) => contract.network === 'bnb')
  assert.ok(bnbContracts.length >= 10)
  assert.ok(bnbContracts.every((contract) => contract.platformId === null))
})
