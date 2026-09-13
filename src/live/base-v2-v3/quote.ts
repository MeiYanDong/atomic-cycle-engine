import { getAddress, isAddressEqual, zeroAddress, type Address, type Hash } from 'viem'

import {
  BASE_PANCAKESWAP_V3_FACTORY,
  BASE_PANCAKESWAP_V3_FEES,
  BASE_PANCAKESWAP_V3_QUOTER_V2,
  BASE_UNISWAP_V2_FACTORY,
  BASE_UNISWAP_V3_FACTORY,
  BASE_UNISWAP_V3_FEES,
  BASE_UNISWAP_V3_QUOTER_V2,
  BASE_WETH,
} from './addresses.js'
import {
  PANCAKESWAP_V3_POOL_ABI,
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

export const BASE_VENUE_CODES = {
  UNISWAP_V2: 0,
  UNISWAP_V3: 1,
  PANCAKESWAP_V3: 2,
} as const

export type BaseVenueId = keyof typeof BASE_VENUE_CODES

interface BasePoolState {
  readonly venue: BaseVenueId
  readonly venueCode: (typeof BASE_VENUE_CODES)[BaseVenueId]
  readonly pool: Address
  readonly token0: Address
  readonly fee: number
  readonly reserve0: bigint | null
  readonly reserve1: bigint | null
  readonly sqrtPriceX96: bigint | null
}

export interface BaseCycleQuote {
  readonly chainId: 8453
  readonly blockNumber: bigint
  readonly blockHash: Hash
  readonly token: BaseCanaryToken
  readonly entryVenue: BaseVenueId
  readonly entryVenueCode: number
  readonly entryPool: Address
  readonly entryFee: number
  readonly exitVenue: BaseVenueId
  readonly exitVenueCode: number
  readonly exitPool: Address
  readonly exitFee: number
  readonly amountIn: bigint
  readonly approximateAmountOut: bigint
  readonly exactAmountOut: bigint | null
  readonly exactGrossProfit: bigint | null
  readonly quoteGas: bigint | null
  readonly disposition: 'SPOT_NEGATIVE' | 'EXACT_NEGATIVE' | 'POSITIVE_GROSS' | 'QUOTE_FAILED'
  readonly error: string | null
}

interface ConcentratedVenueDefinition {
  readonly venue: Exclude<BaseVenueId, 'UNISWAP_V2'>
  readonly factory: Address
  readonly quoter: Address
  readonly fees: readonly number[]
  readonly poolAbi: typeof UNISWAP_V3_POOL_ABI | typeof PANCAKESWAP_V3_POOL_ABI
}

const CONCENTRATED_VENUES: readonly ConcentratedVenueDefinition[] = [
  {
    venue: 'UNISWAP_V3',
    factory: BASE_UNISWAP_V3_FACTORY,
    quoter: BASE_UNISWAP_V3_QUOTER_V2,
    fees: BASE_UNISWAP_V3_FEES,
    poolAbi: UNISWAP_V3_POOL_ABI,
  },
  {
    venue: 'PANCAKESWAP_V3',
    factory: BASE_PANCAKESWAP_V3_FACTORY,
    quoter: BASE_PANCAKESWAP_V3_QUOTER_V2,
    fees: BASE_PANCAKESWAP_V3_FEES,
    poolAbi: PANCAKESWAP_V3_POOL_ABI,
  },
]

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
  if (amountIn <= 0n || sqrtPriceX96 <= 0n || fee < 0 || fee >= Number(V3_FEE_DENOMINATOR)) {
    return 0n
  }
  const afterFee = amountIn * (V3_FEE_DENOMINATOR - BigInt(fee))
  const squaredPrice = sqrtPriceX96 * sqrtPriceX96
  return zeroForOne
    ? (afterFee * squaredPrice) / (V3_FEE_DENOMINATOR * Q192)
    : (afterFee * Q192) / (V3_FEE_DENOMINATOR * squaredPrice)
}

function concentratedDefinition(
  venue: Exclude<BaseVenueId, 'UNISWAP_V2'>,
): ConcentratedVenueDefinition {
  const definition = CONCENTRATED_VENUES.find((candidate) => candidate.venue === venue)
  if (definition === undefined) throw new Error(`unsupported concentrated venue: ${venue}`)
  return definition
}

async function readPoolIdentities(
  client: BaseReadClient,
  token: Address,
  blockNumber: bigint,
): Promise<readonly Readonly<{ venue: BaseVenueId; pool: Address; fee: number }>[]> {
  const definitions = CONCENTRATED_VENUES.flatMap((venue) =>
    venue.fees.map((fee) => ({ venue, fee })),
  )
  const [pair, ...concentratedPools] = await Promise.all([
    client.readContract({
      address: BASE_UNISWAP_V2_FACTORY,
      abi: UNISWAP_V2_FACTORY_ABI,
      functionName: 'getPair',
      args: [BASE_WETH, token],
      blockNumber,
    }),
    ...definitions.map(({ venue, fee }) =>
      client.readContract({
        address: venue.factory,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [BASE_WETH, token, fee],
        blockNumber,
      }),
    ),
  ])

  const identities: Array<Readonly<{ venue: BaseVenueId; pool: Address; fee: number }>> = []
  const v2Pair = getAddress(pair)
  if (!isAddressEqual(v2Pair, zeroAddress)) {
    identities.push({ venue: 'UNISWAP_V2', pool: v2Pair, fee: 0 })
  }
  concentratedPools.forEach((pool, index) => {
    const definition = definitions[index]
    if (definition === undefined) return
    const address = getAddress(pool)
    if (!isAddressEqual(address, zeroAddress)) {
      identities.push({ venue: definition.venue.venue, pool: address, fee: definition.fee })
    }
  })
  return identities
}

async function readPoolState(
  client: BaseReadClient,
  identity: Readonly<{ venue: BaseVenueId; pool: Address; fee: number }>,
  blockNumber: bigint,
): Promise<BasePoolState | null> {
  if (identity.venue === 'UNISWAP_V2') {
    const [token0Value, reserves] = await Promise.all([
      client.readContract({
        address: identity.pool,
        abi: UNISWAP_V2_PAIR_ABI,
        functionName: 'token0',
        blockNumber,
      }),
      client.readContract({
        address: identity.pool,
        abi: UNISWAP_V2_PAIR_ABI,
        functionName: 'getReserves',
        blockNumber,
      }),
    ])
    if (reserves[0] === 0n || reserves[1] === 0n) return null
    return {
      ...identity,
      venueCode: BASE_VENUE_CODES[identity.venue],
      token0: getAddress(token0Value),
      reserve0: reserves[0],
      reserve1: reserves[1],
      sqrtPriceX96: null,
    }
  }

  const definition = concentratedDefinition(identity.venue)
  const [token0Value, slot0, liquidity] = await Promise.all([
    client.readContract({
      address: identity.pool,
      abi: definition.poolAbi,
      functionName: 'token0',
      blockNumber,
    }),
    client.readContract({
      address: identity.pool,
      abi: definition.poolAbi,
      functionName: 'slot0',
      blockNumber,
    }),
    client.readContract({
      address: identity.pool,
      abi: definition.poolAbi,
      functionName: 'liquidity',
      blockNumber,
    }),
  ])
  if (slot0[0] === 0n || liquidity === 0n) return null
  return {
    ...identity,
    venueCode: BASE_VENUE_CODES[identity.venue],
    token0: getAddress(token0Value),
    reserve0: null,
    reserve1: null,
    sqrtPriceX96: slot0[0],
  }
}

function spotLeg(state: BasePoolState, tokenIn: Address, amountIn: bigint): bigint {
  if (state.venue === 'UNISWAP_V2') {
    if (state.reserve0 === null || state.reserve1 === null) return 0n
    const zeroForOne = isAddressEqual(state.token0, tokenIn)
    return uniswapV2AmountOut(
      amountIn,
      zeroForOne ? state.reserve0 : state.reserve1,
      zeroForOne ? state.reserve1 : state.reserve0,
    )
  }
  if (state.sqrtPriceX96 === null) return 0n
  return uniswapV3SpotAmountOut(
    amountIn,
    state.sqrtPriceX96,
    state.fee,
    isAddressEqual(state.token0, tokenIn),
  )
}

async function exactLeg(
  client: BaseReadClient,
  state: BasePoolState,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  blockNumber: bigint,
): Promise<readonly [amountOut: bigint, quoteGas: bigint]> {
  if (state.venue === 'UNISWAP_V2') return [spotLeg(state, tokenIn, amountIn), 0n]
  const definition = concentratedDefinition(state.venue)
  const simulation = await client.simulateContract({
    address: definition.quoter,
    abi: UNISWAP_V3_QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn,
        fee: state.fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
    blockNumber,
  })
  return [simulation.result[0], simulation.result[3]]
}

function quoteBase(
  blockNumber: bigint,
  blockHash: Hash,
  token: BaseCanaryToken,
  entry: BasePoolState,
  exit: BasePoolState,
  amountIn: bigint,
  approximateAmountOut: bigint,
) {
  return {
    chainId: 8453 as const,
    blockNumber,
    blockHash,
    token,
    entryVenue: entry.venue,
    entryVenueCode: entry.venueCode,
    entryPool: entry.pool,
    entryFee: entry.fee,
    exitVenue: exit.venue,
    exitVenueCode: exit.venueCode,
    exitPool: exit.pool,
    exitFee: exit.fee,
    amountIn,
    approximateAmountOut,
  }
}

async function quoteCycleAtBlock(
  client: BaseReadClient,
  blockNumber: bigint,
  blockHash: Hash,
  token: BaseCanaryToken,
  entry: BasePoolState,
  exit: BasePoolState,
  amountIn: bigint,
): Promise<BaseCycleQuote> {
  const approximateIntermediate = spotLeg(entry, BASE_WETH, amountIn)
  const approximateAmountOut = spotLeg(exit, token.address, approximateIntermediate)
  const base = quoteBase(blockNumber, blockHash, token, entry, exit, amountIn, approximateAmountOut)
  if (approximateAmountOut <= amountIn) {
    return {
      ...base,
      exactAmountOut: null,
      exactGrossProfit: null,
      quoteGas: null,
      disposition: 'SPOT_NEGATIVE',
      error: null,
    }
  }

  try {
    const [intermediate, entryQuoteGas] = await exactLeg(
      client,
      entry,
      BASE_WETH,
      token.address,
      amountIn,
      blockNumber,
    )
    const [exactAmountOut, exitQuoteGas] = await exactLeg(
      client,
      exit,
      token.address,
      BASE_WETH,
      intermediate,
      blockNumber,
    )
    const positive = exactAmountOut > amountIn
    return {
      ...base,
      exactAmountOut,
      exactGrossProfit: positive ? exactAmountOut - amountIn : 0n,
      quoteGas: entryQuoteGas + exitQuoteGas,
      disposition: positive ? 'POSITIVE_GROSS' : 'EXACT_NEGATIVE',
      error: null,
    }
  } catch (error) {
    return {
      ...base,
      exactAmountOut: null,
      exactGrossProfit: null,
      quoteGas: null,
      disposition: 'QUOTE_FAILED',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readCanonicalIdentity(
  client: BaseReadClient,
  token: Address,
  venue: BaseVenueId,
  fee: number,
  blockNumber: bigint,
): Promise<Readonly<{ venue: BaseVenueId; pool: Address; fee: number }>> {
  if (venue === 'UNISWAP_V2') {
    if (fee !== 0) throw new Error('invalid Uniswap V2 fee')
    const pool = getAddress(
      await client.readContract({
        address: BASE_UNISWAP_V2_FACTORY,
        abi: UNISWAP_V2_FACTORY_ABI,
        functionName: 'getPair',
        args: [BASE_WETH, token],
        blockNumber,
      }),
    )
    if (isAddressEqual(pool, zeroAddress)) throw new Error('canonical pool disappeared')
    return { venue, pool, fee }
  }

  const definition = concentratedDefinition(venue)
  if (!definition.fees.includes(fee)) throw new Error('invalid concentrated-pool fee')
  const pool = getAddress(
    await client.readContract({
      address: definition.factory,
      abi: UNISWAP_V3_FACTORY_ABI,
      functionName: 'getPool',
      args: [BASE_WETH, token, fee],
      blockNumber,
    }),
  )
  if (isAddressEqual(pool, zeroAddress)) throw new Error('canonical pool disappeared')
  return { venue, pool, fee }
}

/**
 * Re-prices one already discovered route against one fresh canonical block.
 * This keeps the signing path off a several-second-old full-market snapshot.
 */
export async function requoteBaseCycle(
  client: BaseReadClient,
  candidate: BaseCycleQuote,
): Promise<BaseCycleQuote> {
  const block = await client.getBlock({ blockTag: 'latest' })
  const [entryIdentity, exitIdentity] = await Promise.all([
    readCanonicalIdentity(
      client,
      candidate.token.address,
      candidate.entryVenue,
      candidate.entryFee,
      block.number,
    ),
    readCanonicalIdentity(
      client,
      candidate.token.address,
      candidate.exitVenue,
      candidate.exitFee,
      block.number,
    ),
  ])
  if (
    !isAddressEqual(entryIdentity.pool, candidate.entryPool) ||
    !isAddressEqual(exitIdentity.pool, candidate.exitPool)
  ) {
    throw new Error('canonical route changed during re-quote')
  }
  const [entry, exit] = await Promise.all([
    readPoolState(client, entryIdentity, block.number),
    readPoolState(client, exitIdentity, block.number),
  ])
  if (entry === null || exit === null) throw new Error('canonical route has no active liquidity')
  return quoteCycleAtBlock(
    client,
    block.number,
    block.hash,
    candidate.token,
    entry,
    exit,
    candidate.amountIn,
  )
}

export async function quoteBaseTokenCycles(
  client: BaseReadClient,
  token: BaseCanaryToken,
  amounts: readonly bigint[],
): Promise<readonly BaseCycleQuote[]> {
  const block = await client.getBlock({ blockTag: 'latest' })
  const identities = await readPoolIdentities(client, token.address, block.number)
  const states = (
    await Promise.all(identities.map((identity) => readPoolState(client, identity, block.number)))
  ).filter((state): state is BasePoolState => state !== null)
  const orderedAmounts = [...amounts].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  const pairTasks = states.flatMap((entry) =>
    states
      .filter((exit) => !isAddressEqual(entry.pool, exit.pool))
      .map(async (exit): Promise<readonly BaseCycleQuote[]> => {
        const quotes: BaseCycleQuote[] = []
        for (const amountIn of orderedAmounts) {
          const quote = await quoteCycleAtBlock(
            client,
            block.number,
            block.hash,
            token,
            entry,
            exit,
            amountIn,
          )
          quotes.push(quote)
          if (quote.disposition !== 'POSITIVE_GROSS') break
        }
        return quotes
      }),
  )
  return (await Promise.all(pairTasks)).flat()
}
