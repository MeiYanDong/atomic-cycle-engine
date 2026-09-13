import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getAddress, keccak256, toHex, type PrivateKeyAccount } from 'viem'

import { BASE_WETH } from '../src/live/base-v2-v3/addresses.js'
import type { BaseReadClient } from '../src/live/base-v2-v3/client.js'
import { prepareLivePlan } from '../src/live/base-v2-v3/execution.js'
import { loadBaseLivePolicy } from '../src/live/base-v2-v3/policy.js'
import {
  requoteBaseCycle,
  uniswapV2AmountOut,
  uniswapV3SpotAmountOut,
  type BaseCycleQuote,
} from '../src/live/base-v2-v3/quote.js'

const token = {
  symbol: 'TEST',
  name: 'Test Token',
  address: getAddress('0x1000000000000000000000000000000000000001'),
  decimals: 18,
  policyTier: 'CORE' as const,
  source: 'test fixture',
}
const entryPool = getAddress('0x2000000000000000000000000000000000000002')
const exitPool = getAddress('0x3000000000000000000000000000000000000003')
const oldBlockHash = keccak256(toHex('old block'))
const freshBlockHash = keccak256(toHex('fresh block'))

function discoveredCandidate(): BaseCycleQuote {
  return {
    chainId: 8453,
    blockNumber: 98n,
    blockHash: oldBlockHash,
    token,
    entryVenue: 'UNISWAP_V2',
    entryVenueCode: 0,
    entryPool,
    entryFee: 0,
    exitVenue: 'UNISWAP_V3',
    exitVenueCode: 1,
    exitPool,
    exitFee: 500,
    amountIn: 100n,
    approximateAmountOut: 180n,
    exactAmountOut: 180n,
    exactGrossProfit: 80n,
    quoteGas: 10n,
    disposition: 'POSITIVE_GROSS',
    error: null,
  }
}

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

  void it('re-quotes only the selected canonical route at a fresh block', async () => {
    const client = {
      getBlock: () => Promise.resolve({ number: 99n, hash: freshBlockHash }),
      readContract: (request: { readonly functionName: string; readonly address: string }) => {
        if (request.functionName === 'getPair') return Promise.resolve(entryPool)
        if (request.functionName === 'getPool') return Promise.resolve(exitPool)
        if (request.functionName === 'token0') return Promise.resolve(BASE_WETH)
        if (request.functionName === 'getReserves') return Promise.resolve([1_000n, 2_000n, 0])
        if (request.functionName === 'slot0') {
          return Promise.resolve([2n ** 96n, 0, 0, 0, 0, 0, true])
        }
        if (request.functionName === 'liquidity') return Promise.resolve(1_000n)
        return Promise.reject(new Error(`unexpected read ${request.functionName}`))
      },
      simulateContract: () => Promise.resolve({ result: [180n, 0n, 0, 10n] }),
    } as unknown as BaseReadClient

    const quote = await requoteBaseCycle(client, discoveredCandidate())
    assert.equal(quote.blockNumber, 99n)
    assert.equal(quote.blockHash, freshBlockHash)
    assert.equal(quote.disposition, 'POSITIVE_GROSS')
    assert.equal(quote.exactGrossProfit, 80n)
  })

  void it('rejects dust gross profit before making any executor or gas RPC reads', async () => {
    let readAttempted = false
    const client = new Proxy(
      {},
      {
        get: () => {
          readAttempted = true
          throw new Error('unexpected RPC read')
        },
      },
    ) as BaseReadClient
    const account = {
      address: getAddress('0x4000000000000000000000000000000000000004'),
    } as PrivateKeyAccount
    const policy = loadBaseLivePolicy({
      BASE_LIVE_ARM: '1',
      BASE_LIVE_AUTHORIZATION_ID: 'test-live-authorization',
      BASE_EXECUTOR_ADDRESS: getAddress('0x5000000000000000000000000000000000000005'),
      BASE_MIN_CONTRACT_PROFIT_WEI: '1000',
      BASE_MIN_NET_PROFIT_WEI: '5000',
    })

    await assert.rejects(
      prepareLivePlan(client, account, policy, {
        ...discoveredCandidate(),
        exactAmountOut: 101n,
        exactGrossProfit: 1n,
      }),
      /below the contract profit floor/,
    )
    assert.equal(readAttempted, false)
  })
})
