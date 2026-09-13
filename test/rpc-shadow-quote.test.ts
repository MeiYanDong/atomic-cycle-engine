import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeFunctionData, encodeFunctionResult, getAddress, type Hex } from 'viem'

import type { ReadOnlyRpcClient } from '../src/rpc/read-only-client.js'
import type { DirectQuoteInput } from '../src/shadow/cross-venue.js'
import { BALANCER_V3_BATCH_ROUTER_ABI, createRpcDirectQuote } from '../src/shadow/rpc-quote.js'

void test('Balancer v3 pool adapter emits a fixed-block neutral-sender exact quote', async () => {
  const tokenIn = {
    symbol: 'IN',
    address: getAddress('0x0000000000000000000000000000000000000001'),
    decimals: 18,
  }
  const tokenOut = {
    symbol: 'OUT',
    address: getAddress('0x0000000000000000000000000000000000000002'),
    decimals: 18,
  }
  const router = getAddress('0x0000000000000000000000000000000000000003')
  const pool = getAddress('0x0000000000000000000000000000000000000004')
  const calls: readonly unknown[][] = []
  const mutableCalls = calls as unknown[][]
  const encodedResult = encodeFunctionResult({
    abi: BALANCER_V3_BATCH_ROUTER_ABI,
    functionName: 'querySwapExactIn',
    result: [[12_345n], [tokenOut.address], [12_345n]],
  })
  const client = {
    request(method: string, params: readonly unknown[]) {
      assert.equal(method, 'eth_call')
      mutableCalls.push([...params])
      return Promise.resolve(encodedResult)
    },
  } as unknown as ReadOnlyRpcClient
  const adapter = createRpcDirectQuote(client)
  const input: DirectQuoteInput = {
    venue: {
      id: 'EARN_POOL',
      label: 'Earn pool',
      kind: 'BALANCER_V3_BATCH_ROUTER',
      router,
      pool,
    },
    tokenIn,
    tokenOut,
    amountIn: 10_000n,
    blockNumber: 123n,
  }

  const quote = await adapter.quote(input)
  assert.deepEqual(quote, { amountOut: 12_345n, feeTier: null })
  assert.equal(calls.length, 1)
  const [call, blockTag] = calls[0] as [{ to: string; data: Hex }, string]
  assert.equal(call.to, router)
  assert.equal(blockTag, '0x7b')
  const decoded = decodeFunctionData({ abi: BALANCER_V3_BATCH_ROUTER_ABI, data: call.data })
  assert.equal(decoded.functionName, 'querySwapExactIn')
  assert.equal(decoded.args[0][0]?.steps[0]?.pool, pool)
  assert.equal(decoded.args[0][0].exactAmountIn, 10_000n)
  assert.equal(decoded.args[1], '0x0000000000000000000000000000000000000001')
  assert.deepEqual(adapter.stats(), {
    logicalQuotes: 1,
    rpcCalls: 1,
    failedRpcCalls: 0,
    unavailableQuotes: 0,
  })
})
