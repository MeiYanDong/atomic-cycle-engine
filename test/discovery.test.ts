import assert from 'node:assert/strict'
import test from 'node:test'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  type Hex,
} from 'viem'

import { readAerodromePoolFactories } from '../src/discovery/aerodrome-registry.js'
import {
  decodePoolFact,
  eventSourcesForNetwork,
  type FactoryEventKind,
  type FactoryEventSource,
  type RawRpcLog,
} from '../src/discovery/factory-events.js'
import { scanDiscoveryWindow } from '../src/discovery/window-scan.js'
import { ReadOnlyRpcClient } from '../src/rpc/read-only-client.js'
import { testAddress } from './fixtures.js'

const blockHash = keccak256(toHex('block'))
const transactionHash = keccak256(toHex('transaction'))

function source(kind: FactoryEventKind): FactoryEventSource {
  const result = eventSourcesForNetwork('base').find((item) => item.kind === kind)
  assert.ok(result)
  return result
}

function logFor(
  eventSource: FactoryEventSource,
  indexedArgs: Record<string, unknown>,
  data: Hex,
): RawRpcLog {
  const topics = encodeEventTopics({
    abi: [eventSource.event],
    eventName: eventSource.event.name,
    args: indexedArgs,
  }).filter((topic): topic is Hex => topic !== null)
  return {
    address: eventSource.address,
    blockHash,
    blockNumber: '0x64',
    data,
    logIndex: '0x2',
    topics,
    transactionHash,
  }
}

void test('decodes Uniswap v2 and v3 factory facts with their distinct fee units', () => {
  const token0 = testAddress(101)
  const token1 = testAddress(102)
  const v2Pool = testAddress(103)
  const v3Pool = testAddress(104)
  const v2 = source('UNISWAP_V2')
  const v3 = source('UNISWAP_V3')
  const v2Fact = decodePoolFact(
    v2,
    logFor(
      v2,
      { token0, token1 },
      encodeAbiParameters(
        [
          { type: 'address', name: 'pair' },
          { type: 'uint256', name: 'pairCount' },
        ],
        [v2Pool, 1n],
      ),
    ),
  )
  const v3Fact = decodePoolFact(
    v3,
    logFor(
      v3,
      { token0, token1, fee: 500 },
      encodeAbiParameters(
        [
          { type: 'int24', name: 'tickSpacing' },
          { type: 'address', name: 'pool' },
        ],
        [10, v3Pool],
      ),
    ),
  )

  assert.equal(v2Fact.poolAddress, v2Pool)
  assert.equal(v2Fact.feeUnit, 'BPS')
  assert.equal(v2Fact.feeValue, 30)
  assert.equal(v3Fact.poolAddress, v3Pool)
  assert.equal(v3Fact.feeUnit, 'PIPS')
  assert.equal(v3Fact.feeValue, 500)
  assert.equal(v3Fact.tickSpacing, 10)
})

void test('decodes Uniswap v4 singleton pool identity and hook without inventing an address', () => {
  const eventSource = source('UNISWAP_V4')
  const currency0 = testAddress(111)
  const currency1 = testAddress(112)
  const hooks = testAddress(113)
  const id = keccak256(toHex('pool-id'))
  const fact = decodePoolFact(
    eventSource,
    logFor(
      eventSource,
      { id, currency0, currency1 },
      encodeAbiParameters(
        [
          { type: 'uint24', name: 'fee' },
          { type: 'int24', name: 'tickSpacing' },
          { type: 'address', name: 'hooks' },
          { type: 'uint160', name: 'sqrtPriceX96' },
          { type: 'int24', name: 'tick' },
        ],
        [3_000, 60, hooks, 2n ** 96n, 0],
      ),
    ),
  )

  assert.equal(fact.poolIdentity, id)
  assert.equal(fact.poolAddress, null)
  assert.equal(fact.hooks, hooks)
  assert.equal(fact.feeUnit, 'PIPS_OR_DYNAMIC')
})

void test('decodes Aerodrome stable and Slipstream events without sharing curve semantics', () => {
  const token0 = testAddress(121)
  const token1 = testAddress(122)
  const standardPool = testAddress(123)
  const clPool = testAddress(124)
  const standard = source('AERODROME_STANDARD')
  const slipstream = source('SLIPSTREAM')
  const standardFact = decodePoolFact(
    standard,
    logFor(
      standard,
      { token0, token1, stable: true },
      encodeAbiParameters(
        [
          { type: 'address', name: 'pool' },
          { type: 'uint256', name: 'poolCount' },
        ],
        [standardPool, 1n],
      ),
    ),
  )
  const clFact = decodePoolFact(
    slipstream,
    logFor(
      slipstream,
      { token0, token1, tickSpacing: 100 },
      encodeAbiParameters([{ type: 'address', name: 'pool' }], [clPool]),
    ),
  )

  assert.equal(standardFact.stable, true)
  assert.equal(standardFact.feeUnit, 'DYNAMIC')
  assert.equal(clFact.stable, null)
  assert.equal(clFact.tickSpacing, 100)
})

void test('reads the current Aerodrome factory set at an explicit block', async () => {
  const factories = [testAddress(131), testAddress(132)] as const
  const abi = parseAbi(['function poolFactories() view returns (address[])'])
  const encoded = encodeFunctionResult({ abi, functionName: 'poolFactories', result: factories })
  const client = new ReadOnlyRpcClient('https://rpc.example', (_endpoint, request) => {
    assert.equal(request.method, 'eth_call')
    assert.ok(Array.isArray(request.params))
    assert.deepEqual(request.params[1], '0x64')
    return Promise.resolve({ jsonrpc: '2.0', id: request.id, result: encoded })
  })
  assert.deepEqual(
    await readAerodromePoolFactories(client, testAddress(130), '0x64'),
    factories.map((factory) => getAddress(factory)),
  )
})

void test('window scan marks any failed source range as a gap instead of empty history', async () => {
  const eventSource = source('UNISWAP_V2')
  const client = new ReadOnlyRpcClient('https://rpc.example', (_endpoint, request) =>
    Promise.resolve({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32_005, message: 'range unavailable' },
    }),
  )
  const result = await scanDiscoveryWindow({
    client,
    sources: [eventSource],
    fromBlock: 100n,
    throughBlock: 109n,
    chunkSize: 5n,
  })
  assert.equal(result.status, 'GAPPED')
  assert.equal(result.coverage[0]?.gaps.length, 2)
  assert.equal(result.facts.length, 0)
})
