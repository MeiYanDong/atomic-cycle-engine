import assert from 'node:assert/strict'
import test from 'node:test'

import type { GasCostModel, QuoteAdapter, StateReference } from '../src/domain/types.js'
import { evaluateCycle, selectBestAmount } from '../src/quote/evaluate-cycle.js'
import { quoteV2ExactInput } from '../src/quote/v2-constant-product.js'
import { asset, edge, fixtureState } from './fixtures.js'

const base = asset(1, 'BASE')
const quote = asset(2, 'QUOTE')
const route = {
  id: 'entry>exit',
  chainId: 8453,
  baseAsset: base,
  edges: [
    edge({ id: 'entry', source: 'entry-pool', tokenIn: base, tokenOut: quote }),
    edge({ id: 'exit', source: 'exit-pool', tokenIn: quote, tokenOut: base }),
  ],
}

function adapter(state: StateReference = fixtureState): QuoteAdapter {
  return {
    id: 'fixture',
    quoteExactInput(swapEdge, amountIn) {
      return Promise.resolve({
        edgeId: swapEdge.id,
        amountIn,
        amountOut: swapEdge.id === 'entry' ? 120n : 115n,
        gasEstimate: swapEdge.id === 'entry' ? 30n : 20n,
        state,
        evidenceLevel: 'live_observed',
      })
    },
  }
}

const gasCostModel: GasCostModel = {
  estimateCostInBaseAsset({ totalGas, state }) {
    return Promise.resolve({
      totalGas,
      costInBaseAsset: 5n,
      state,
      evidenceLevel: 'live_observed',
    })
  },
}

void test('evaluates the entire cycle at one state and after all modeled costs', async () => {
  const result = await evaluateCycle({
    route,
    amountIn: 100n,
    state: fixtureState,
    adapters: new Map([['fixture', adapter()]]),
    gasCostModel,
    policy: { minimumNetProfitInBaseAsset: 8n, riskBufferInBaseAsset: 2n },
  })

  assert.equal(result.amountOut, 115n)
  assert.equal(result.totalGas, 50n)
  assert.equal(result.netProfitInBaseAsset, 8n)
  assert.equal(result.disposition, 'ELIGIBLE_SHADOW')
})

void test('fails closed when one hop uses a different state commitment', async () => {
  const staleState: StateReference = { ...fixtureState, commitment: 'sha256:stale' }
  await assert.rejects(
    evaluateCycle({
      route,
      amountIn: 100n,
      state: fixtureState,
      adapters: new Map([['fixture', adapter(staleState)]]),
      gasCostModel,
      policy: { minimumNetProfitInBaseAsset: 1n, riskBufferInBaseAsset: 0n },
    }),
    /mixed-state quote/,
  )
})

void test('selects the best net profit and breaks ties toward lower capital', () => {
  const common = {
    routeId: route.id,
    state: fixtureState,
    amountOut: 120n,
    hopQuotes: [],
    totalGas: 0n,
    gasCostInBaseAsset: 0n,
    riskBufferInBaseAsset: 0n,
    minimumNetProfitInBaseAsset: 1n,
    disposition: 'ELIGIBLE_SHADOW' as const,
    evidenceLevel: 'live_observed' as const,
  }
  const best = selectBestAmount([
    { ...common, amountIn: 20n, netProfitInBaseAsset: 10n },
    { ...common, amountIn: 10n, netProfitInBaseAsset: 10n },
    { ...common, amountIn: 5n, netProfitInBaseAsset: 8n },
  ])
  assert.equal(best?.amountIn, 10n)
})

void test('quotes constant-product pools with fee and integer round-down', () => {
  assert.equal(
    quoteV2ExactInput({ amountIn: 1_000n, reserveIn: 100_000n, reserveOut: 200_000n, feeBps: 30 }),
    1_974n,
  )
})
