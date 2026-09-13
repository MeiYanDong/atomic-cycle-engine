import {
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'

import type { ReadOnlyRpcClient } from '../rpc/read-only-client.js'
import type { DirectQuote, DirectQuoteInput, DirectQuoteResult } from './cross-venue.js'

const V2_ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
])

const V3_FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
])

export const BALANCER_V3_BATCH_ROUTER_ABI = [
  {
    type: 'function',
    name: 'querySwapExactIn',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'paths',
        type: 'tuple[]',
        components: [
          { name: 'tokenIn', type: 'address' },
          {
            name: 'steps',
            type: 'tuple[]',
            components: [
              { name: 'pool', type: 'address' },
              { name: 'tokenOut', type: 'address' },
              { name: 'isBuffer', type: 'bool' },
            ],
          },
          { name: 'exactAmountIn', type: 'uint256' },
          { name: 'minAmountOut', type: 'uint256' },
        ],
      },
      { name: 'sender', type: 'address' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [
      { name: 'pathAmountsOut', type: 'uint256[]' },
      { name: 'tokensOut', type: 'address[]' },
      { name: 'amountsOut', type: 'uint256[]' },
    ],
  },
] as const

const NEUTRAL_QUERY_SENDER = '0x0000000000000000000000000000000000000001' as const

const QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export interface RpcQuoteStats {
  readonly logicalQuotes: number
  readonly rpcCalls: number
  readonly failedRpcCalls: number
  readonly unavailableQuotes: number
}

export interface RpcDirectQuoteAdapter {
  readonly quote: DirectQuote
  stats(): RpcQuoteStats
}

class RpcConcurrencyGate {
  readonly #maximum: number
  #active = 0
  readonly #waiting: Array<() => void> = []

  constructor(maximum: number) {
    this.#maximum = maximum
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#maximum) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve))
    }
    this.#active += 1
    try {
      return await operation()
    } finally {
      this.#active -= 1
      this.#waiting.shift()?.()
    }
  }
}

function isUnavailableRoute(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /revert|invalid opcode|insufficient liquidity|unexpected amount of data|returned no data/i.test(
    message,
  )
}

function blockHex(blockNumber: bigint): Hex {
  return `0x${blockNumber.toString(16)}`
}

async function rawCall(
  client: ReadOnlyRpcClient,
  gate: RpcConcurrencyGate,
  to: `0x${string}`,
  data: Hex,
  blockNumber: bigint,
): Promise<Hex> {
  return gate.run(() => client.request<Hex>('eth_call', [{ to, data }, blockHex(blockNumber)]))
}

async function quoteV2(
  client: ReadOnlyRpcClient,
  gate: RpcConcurrencyGate,
  input: DirectQuoteInput,
): Promise<DirectQuoteResult | null> {
  if (input.venue.kind !== 'V2_ROUTER') return null
  const data = encodeFunctionData({
    abi: V2_ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [input.amountIn, [input.tokenIn.address, input.tokenOut.address]],
  })
  const encoded = await rawCall(client, gate, input.venue.router, data, input.blockNumber)
  const amounts = decodeFunctionResult({
    abi: V2_ROUTER_ABI,
    functionName: 'getAmountsOut',
    data: encoded,
  })
  const amountOut = amounts.at(-1)
  return amountOut === undefined || amountOut <= 0n ? null : { amountOut, feeTier: null }
}

async function quoteBalancerV3Pool(
  client: ReadOnlyRpcClient,
  gate: RpcConcurrencyGate,
  input: DirectQuoteInput,
): Promise<DirectQuoteResult | null> {
  if (input.venue.kind !== 'BALANCER_V3_BATCH_ROUTER') return null
  const data = encodeFunctionData({
    abi: BALANCER_V3_BATCH_ROUTER_ABI,
    functionName: 'querySwapExactIn',
    args: [
      [
        {
          tokenIn: input.tokenIn.address,
          steps: [{ pool: input.venue.pool, tokenOut: input.tokenOut.address, isBuffer: false }],
          exactAmountIn: input.amountIn,
          minAmountOut: 0n,
        },
      ],
      NEUTRAL_QUERY_SENDER,
      '0x',
    ],
  })
  const encoded = await rawCall(client, gate, input.venue.router, data, input.blockNumber)
  const [pathAmountsOut] = decodeFunctionResult({
    abi: BALANCER_V3_BATCH_ROUTER_ABI,
    functionName: 'querySwapExactIn',
    data: encoded,
  })
  const amountOut = pathAmountsOut[0]
  return amountOut === undefined || amountOut <= 0n ? null : { amountOut, feeTier: null }
}

async function quoteV3Fee(
  client: ReadOnlyRpcClient,
  gate: RpcConcurrencyGate,
  input: DirectQuoteInput & {
    readonly venue: Extract<DirectQuoteInput['venue'], { kind: 'V3_QUOTER_V2' }>
  },
  fee: number,
): Promise<DirectQuoteResult> {
  const data = encodeFunctionData({
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn: input.tokenIn.address,
        tokenOut: input.tokenOut.address,
        amountIn: input.amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
  const encoded = await rawCall(client, gate, input.venue.quoter, data, input.blockNumber)
  const [amountOut] = decodeFunctionResult({
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    data: encoded,
  })
  return { amountOut, feeTier: fee }
}

async function readV3Pool(
  client: ReadOnlyRpcClient,
  gate: RpcConcurrencyGate,
  input: DirectQuoteInput & {
    readonly venue: Extract<DirectQuoteInput['venue'], { kind: 'V3_QUOTER_V2' }>
  },
  fee: number,
): Promise<Address> {
  const data = encodeFunctionData({
    abi: V3_FACTORY_ABI,
    functionName: 'getPool',
    args: [input.tokenIn.address, input.tokenOut.address, fee],
  })
  const encoded = await rawCall(client, gate, input.venue.factory, data, input.blockNumber)
  return decodeFunctionResult({
    abi: V3_FACTORY_ABI,
    functionName: 'getPool',
    data: encoded,
  })
}

function bestQuote(quotes: readonly (DirectQuoteResult | null)[]): DirectQuoteResult | null {
  return quotes.reduce<DirectQuoteResult | null>((best, current) => {
    if (current === null || current.amountOut <= 0n) return best
    return best === null || current.amountOut > best.amountOut ? current : best
  }, null)
}

export function createRpcDirectQuote(client: ReadOnlyRpcClient): RpcDirectQuoteAdapter {
  let logicalQuotes = 0
  let rpcCalls = 0
  let failedRpcCalls = 0
  let unavailableQuotes = 0
  const gate = new RpcConcurrencyGate(4)
  const cache = new Map<string, Promise<DirectQuoteResult | null>>()
  const poolCache = new Map<string, Promise<boolean>>()

  async function hasV3Pool(
    input: DirectQuoteInput & {
      readonly venue: Extract<DirectQuoteInput['venue'], { kind: 'V3_QUOTER_V2' }>
    },
    fee: number,
  ): Promise<boolean> {
    const tokens = [
      input.tokenIn.address.toLowerCase(),
      input.tokenOut.address.toLowerCase(),
    ].sort()
    const key = [input.blockNumber.toString(), input.venue.id, ...tokens, fee.toString()].join(':')
    const cached = poolCache.get(key)
    if (cached !== undefined) return cached
    const pending = (async (): Promise<boolean> => {
      rpcCalls += 1
      try {
        return !isAddressEqual(await readV3Pool(client, gate, input, fee), zeroAddress)
      } catch (error) {
        if (!isUnavailableRoute(error)) failedRpcCalls += 1
        return false
      }
    })()
    poolCache.set(key, pending)
    return pending
  }

  async function request(input: DirectQuoteInput): Promise<DirectQuoteResult | null> {
    logicalQuotes += 1
    const cacheKey = [
      input.blockNumber.toString(),
      input.venue.id,
      input.tokenIn.address,
      input.tokenOut.address,
      input.amountIn.toString(),
    ].join(':')
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached

    const pending = (async (): Promise<DirectQuoteResult | null> => {
      if (input.venue.kind === 'V2_ROUTER' || input.venue.kind === 'BALANCER_V3_BATCH_ROUTER') {
        rpcCalls += 1
        try {
          return input.venue.kind === 'V2_ROUTER'
            ? await quoteV2(client, gate, input)
            : await quoteBalancerV3Pool(client, gate, input)
        } catch (error) {
          if (!isUnavailableRoute(error)) failedRpcCalls += 1
          return null
        }
      }

      const venue = input.venue
      const quotes = await Promise.all(
        venue.feeTiers.map(async (fee): Promise<DirectQuoteResult | null> => {
          if (!(await hasV3Pool({ ...input, venue }, fee))) return null
          rpcCalls += 1
          try {
            return await quoteV3Fee(client, gate, { ...input, venue }, fee)
          } catch (error) {
            if (!isUnavailableRoute(error)) failedRpcCalls += 1
            return null
          }
        }),
      )
      return bestQuote(quotes)
    })()
    cache.set(cacheKey, pending)
    const result = await pending
    if (result === null) unavailableQuotes += 1
    return result
  }

  return {
    quote: request,
    stats: () => ({ logicalQuotes, rpcCalls, failedRpcCalls, unavailableQuotes }),
  }
}
