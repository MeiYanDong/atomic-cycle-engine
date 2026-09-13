import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { amountGrid, loadBaseLivePolicy } from '../src/live/base-v2-v3/policy.js'

void describe('Base live canary policy', () => {
  void it('keeps live execution disarmed by default while preserving hard caps', () => {
    const policy = loadBaseLivePolicy({})
    assert.equal(policy.liveArm, false)
    assert.equal(policy.maximumAmountIn, 3_000_000_000_000_000n)
    assert.equal(policy.minimumNetProfit, 1n)
    assert.equal(policy.reserveFloor, 5_000_000_000_000_000n)
    assert.equal(policy.cumulativeFailedGasCap, 1_000_000_000_000_000n)
    assert.equal(policy.operatorFeeMultiplierBps, 12_000n)
  })

  void it('keeps the net floor positive while letting conservative gas set the economic threshold', () => {
    assert.throws(() => loadBaseLivePolicy({ BASE_MIN_NET_PROFIT_WEI: '0' }), /must be positive/)
    assert.equal(loadBaseLivePolicy({ BASE_MIN_NET_PROFIT_WEI: '7' }).minimumNetProfit, 7n)
  })

  void it('requires scoped authorization before live arm', () => {
    assert.throws(() => loadBaseLivePolicy({ BASE_LIVE_ARM: '1' }), /authorization id/)
  })

  void it('does not allow environment variables to expand initial canary risk', () => {
    assert.throws(
      () => loadBaseLivePolicy({ BASE_MAX_AMOUNT_IN_WEI: '3000000000000001' }),
      /hard bounds/,
    )
    assert.throws(
      () => loadBaseLivePolicy({ BASE_ETH_RESERVE_FLOOR_WEI: '4999999999999999' }),
      /hard bounds/,
    )
    assert.throws(
      () => loadBaseLivePolicy({ BASE_FAILED_GAS_CAP_WEI: '1000000000000001' }),
      /hard bounds/,
    )
    assert.throws(
      () => loadBaseLivePolicy({ BASE_OPERATOR_FEE_MULTIPLIER_BPS: '9999' }),
      /safety multiplier/,
    )
  })

  void it('creates a deterministic coarse-to-cap capital grid', () => {
    assert.deepEqual(amountGrid(3_000n), [250n, 500n, 1_000n, 1_500n, 3_000n])
  })
})
