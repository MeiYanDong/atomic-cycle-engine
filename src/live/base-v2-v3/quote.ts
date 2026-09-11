import { getAddress, isAddressEqual, zeroAddress, type Address, type Hash } from 'viem'

import {
  BASE_UNISWAP_V2_FACTORY,
  BASE_UNISWAP_V3_FACTORY,
  BASE_UNISWAP_V3_QUOTER_V2,
  BASE_V3_FEES,
  BASE_WETH,
} from './addresses.js'
import {
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_QUOTER_V2_ABI,
} from './abi.js'
import type { BaseReadClient } from './client.js'
import type { BaseCanaryToken } from './tokens.js'

const Q192 = 2n ** 192n
const V3_FEE_DENOMINATOR = 1_000_000n

export interface BaseCycleQuote {
  readonly chainId: 8453
  readonly blockNumber: bigint
  readonly blockHash: Hash
  readonly token: BaseCanaryToken
  readonly v2Pair: Address
  readonly v3Pool: Address
  readonly v3Fee: number
  readonly v2First: boolean
  readonly amountIn: bigint
  readonly approximateAmountOut: bigint
  readonly exactAmountOut: bigint | null
  readonly exactGrossProfit: bigint | null
  readonly v3QuoteGas: bigint | null
  readonly disposition: 'SPOT_NEGATIVE' | 'EXACT_NEGATIVE' | 'POSITIVE_GROSS' | 'QUOTE_FAILED'
  readonly error: string | null
}

interface V2State {
  readonly pair: Address
  readonly token0: Address
  readonly reserve0: bigint
  readonly reserve1: bigint
}

interface V3State {
  readonly pool: Address
  readonly fee: (typeof BASE_V3_FEES)[number]
  readonly sqrtPriceX96: bigint
  readonly liquidity: bigint
}

export function uniswapV2AmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
  const amountInWithFee = amountIn * 997n
  return (amountInWithFee * reserveOut) / (reserveIn * 1_000n + amountInWithFee)
}

export function uniswapV3SpotAmountOut(
  amountIn: bigint,
  sqrtPriceX96: bigint,
  fee: number,
  zeroForOne: boolean,
): bigint {
  if (
    amountIn <= 0n ||
    sqrtPriceX96 <= 0n ||
    !BASE_V3_FEES.includes(fee as (typeof BASE_V3_FEES)[number])
  ) {
    return 0n
  }
  const afterFee = amountIn * (V3_FEE_DENOMINATOR - BigInt(fee))
  const squaredPrice = sqrtPriceX96 * sqrtPriceX96
  return zeroForOne
    ? (afterFee * squaredPrice) / (V3_FEE_DENOMINATOR * Q192)
    : (afterFee * Q192) / (V3_FEE_DENOMINATOR * squaredPrice)
}

function orderedReserves(
  state: V2State,
  tokenIn: Address,
): readonly [reserveIn: bigint, reserveOut: bigint] {
  return isAddressEqual(state.token0, tokenIn)
    ? [state.reserve0, state.reserve1]
    : [state.reserve1, state.reserve0]
}

function wethIsToken0(token: Address): boolean {
  return BigInt(BASE_WETH) < BigInt(token)
}

async function readPoolIdentities(
  client: BaseReadClient,
  token: Address,
  blockNumber: bigint,
): Promise<readonly [Address, readonly Address[]]> {
  const [pair, ...pools] = await Promise.all([
    client.readContract({
      address: BASE_UNISWAP_V2_FACTORY,
      abi: UNISWAP_V2_FACTORY_ABI,
      functionName: 'getPair',
      args: [BASE_WETH, token],
      blockNumber,
    }),
    ...BASE_V3_FEES.map((fee) =>
      client.readContract({
        address: BASE_UNISWAP_V3_FACTORY,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [BASE_WETH, token, fee],
        blockNumber,
      }),
    ),
  ])
  return [getAddress(pair), pools.map((pool) => getAddress(pool))]
}

async function readPoolStates(
  client: BaseReadClient,
  pair: Address,
  pools: readonly Address[],
  blockNumber: bigint,
): Promise<readonly [V2State, readonly V3State[]]> {
  const activePools = pools
    .map((pool, index) => ({ pool, fee: BASE_V3_FEES[index] }))
    .filter(
      (item): item is { pool: Address; fee: (typeof BASE_V3_FEES)[number] } =>
        item.fee !== undefined && !isAddressEqual(item.pool, zeroAddress),
    )
  const [token0Value, reserves, v3StatesOrNull] = await Promise.all([
    client.readContract({
      address: pair,
      abi: UNISWAP_V2_PAIR_ABI,
      functionName: 'token0',
      blockNumber,
    }),
    client.readContract({
      address: pair,
      abi: UNISWAP_V2_PAIR_ABI,
      functionName: 'getReserves',
      blockNumber,
    }),
    Promise.all(
      activePools.map(async (identity): Promise<V3State | null> => {
        try {
          const [slot0, liquidity] = await Promise.all([
            client.readContract({
              address: identity.pool,
              abi: UNISWAP_V3_POOL_ABI,
              functionName: 'slot0',
              blockNumber,
            }),
            client.readContract({
              address: identity.pool,
              abi: UNISWAP_V3_POOL_ABI,
              functionName: 'liquidity',
              blockNumber,
            }),
          ])
          const sqrtPriceX96 = slot0[0]
          if (sqrtPriceX96 === 0n || liquidity === 0n) return null
          return { ...identity, sqrtPriceX96, liquidity }
        } catch {
          return null
        }
      }),
    ),
  ])
  const token0 = getAddress(token0Value)
  const [reserve0, reserve1] = reserves
  const v3States = v3StatesOrNull.filter((state): state is V3State => state !== null)
  return [{ pair, token0, reserve0, reserve1 }, v3States]
}

async function quoteV3(
  client: BaseReadClient,
  input: {
    readonly tokenIn: Address
    readonly tokenOut: Address
    readonly amountIn: bigint
    readonly fee: number
    readonly blockNumber: bigint
  },
): Promise<readonly [amountOut: bigint, gasEstimate: bigint]> {
  const simulation = await client.simulateContract({
    address: BASE_UNISWAP_V3_QUOTER_V2,
    abi: UNISWAP_V3_QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amountIn: input.amountIn,
        fee: input.fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
    blockNumber: input.blockNumber,
  })
  return [simulation.result[0], simulation.result[3]]
}

function approximateCycle(
  v2: V2State,
  v3: V3State,
  token: Address,
  amountIn: bigint,
  v2First: boolean,
): bigint {
  const baseIsToken0 = wethIsToken0(token)
  if (v2First) {
    const [reserveIn, reserveOut] = orderedReserves(v2, BASE_WETH)
    const intermediate = uniswapV2AmountOut(amountIn, reserveIn, reserveOut)
    return uniswapV3SpotAmountOut(intermediate, v3.sqrtPriceX96, v3.fee, !baseIsToken0)
  }
  const intermediate = uniswapV3SpotAmountOut(amountIn, v3.sqrtPriceX96, v3.fee, baseIsToken0)
  const [reserveIn, reserveOut] = orderedReserves(v2, token)
  return uniswapV2AmountOut(intermediate, reserveIn, reserveOut)
}

async function exactCycle(
  client: BaseReadClient,
  input: {
    readonly v2: V2State
    readonly v3: V3State
    readonly token: Address
    readonly amountIn: bigint
    readonly v2First: boolean
    readonly blockNumber: bigint
  },
): Promise<readonly [amountOut: bigint, v3QuoteGas: bigint]> {
  if (input.v2First) {
    const [reserveIn, reserveOut] = orderedReserves(input.v2, BASE_WETH)
    const intermediate = uniswapV2AmountOut(input.amountIn, reserveIn, reserveOut)
    return quoteV3(client, {
      tokenIn: input.token,
      tokenOut: BASE_WETH,
      amountIn: intermediate,
      fee: input.v3.fee,
      blockNumber: input.blockNumber,
    })
  }
  const [intermediate, gasEstimate] = await quoteV3(client, {
    tokenIn: BASE_WETH,
    tokenOut: input.token,
    amountIn: input.amountIn,
    fee: input.v3.fee,
    blockNumber: input.blockNumber,
  })
  const [reserveIn, reserveOut] = orderedReserves(input.v2, input.token)
  return [uniswapV2AmountOut(intermediate, reserveIn, reserveOut), gasEstimate]
}

export async function quoteBaseTokenCycles(
  client: BaseReadClient,
  token: BaseCanaryToken,
  amounts: readonly bigint[],
): Promise<readonly BaseCycleQuote[]> {
  const block = await client.getBlock({ blockTag: 'latest' })
  const [pair, pools] = await readPoolIdentities(client, token.address, block.number)
  if (isAddressEqual(pair, zeroAddress)) return []
  const [v2, v3States] = await readPoolStates(client, pair, pools, block.number)
  const quotes: BaseCycleQuote[] = []

  for (const v3 of v3States) {
    for (const amountIn of amounts) {
      for (const v2First of [true, false]) {
        const approximateAmountOut = approximateCycle(v2, v3, token.address, amountIn, v2First)
        const base = {
          chainId: 8453 as const,
          blockNumber: block.number,
          blockHash: block.hash,
          token,
          v2Pair: pair,
          v3Pool: v3.pool,
          v3Fee: v3.fee,
          v2First,
          amountIn,
          approximateAmountOut,
        }
        if (approximateAmountOut <= amountIn) {
          quotes.push({
            ...base,
            exactAmountOut: null,
            exactGrossProfit: null,
            v3QuoteGas: null,
            disposition: 'SPOT_NEGATIVE',
            error: null,
          })
          continue
        }
        try {
          const [exactAmountOut, v3QuoteGas] = await exactCycle(client, {
            v2,
            v3,
            token: token.address,
            amountIn,
            v2First,
            blockNumber: block.number,
          })
          const positive = exactAmountOut > amountIn
          quotes.push({
            ...base,
            exactAmountOut,
            exactGrossProfit: positive ? exactAmountOut - amountIn : 0n,
            v3QuoteGas,
            disposition: positive ? 'POSITIVE_GROSS' : 'EXACT_NEGATIVE',
            error: null,
          })
        } catch (error) {
          quotes.push({
            ...base,
            exactAmountOut: null,
            exactGrossProfit: null,
            v3QuoteGas: null,
            disposition: 'QUOTE_FAILED',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  }
  return quotes
}
