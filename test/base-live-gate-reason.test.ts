import assert from 'node:assert/strict'
import test from 'node:test'

import { safeGateReason } from '../src/live/base-v2-v3/gate-reason.js'

void test('turns local live-gate failures into concise Chinese evidence', () => {
  assert.equal(
    safeGateReason(new Error('positive gross quote is below the contract profit floor')),
    '毛利低于合约利润底线',
  )
})

void test('walks nested viem causes without publishing raw error payloads', () => {
  const error = new Error('contract execution failed', {
    cause: { cause: { data: { errorName: 'ProfitTooLow', args: [1n, 2n] } } },
  })
  assert.equal(safeGateReason(error), '链上模拟利润低于执行门槛')
  assert.equal(safeGateReason({ arbitrary: 'provider internals' }), '未知执行校验错误')
})
