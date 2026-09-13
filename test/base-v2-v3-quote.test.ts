import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { uniswapV2AmountOut, uniswapV3SpotAmountOut } from '../src/live/base-v2-v3/quote.js'

void describe('Base V2/V3 quote primitives', () => {
  void it('matches the canonical Uniswap V2 exact-input formula', () => {
    const amountOut = uniswapV2AmountOut(1n * 10n ** 18n, 1_000n * 10n ** 18n, 1_000n * 10n ** 18n)
    assert.equal(amountOut, 996_006_981_039_903_216n)
  })

  void it('applies the V3 fee in either raw-token direction at price one', () => {
    const q96 = 2n ** 96n
    assert.equal(uniswapV3SpotAmountOut(1_000_000n, q96, 500, true), 999_500n)
    assert.equal(uniswapV3SpotAmountOut(1_000_000n, q96, 500, false), 999_500n)
  })

  void it('returns zero instead of creating a quote from invalid state', () => {
    assert.equal(uniswapV2AmountOut(1n, 0n, 1n), 0n)
    assert.equal(uniswapV3SpotAmountOut(1n, 0n, 500, true), 0n)
    assert.equal(uniswapV3SpotAmountOut(1n, 2n ** 96n, 1_000_000, true), 0n)
  })
})
