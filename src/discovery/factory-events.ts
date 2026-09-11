import {
  decodeEventLog,
  getAddress,
  parseAbiItem,
  toEventSelector,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem'

import { CONTRACTS, NETWORKS, type ContractDefinition, type NetworkId } from '../config/registry.js'

export type FactoryEventKind =
  'AERODROME_STANDARD' | 'SLIPSTREAM' | 'UNISWAP_V2' | 'UNISWAP_V3' | 'UNISWAP_V4'

const EVENTS: Readonly<Record<FactoryEventKind, AbiEvent>> = {
  UNISWAP_V2: parseAbiItem(
    'event PairCreated(address indexed token0,address indexed token1,address pair,uint256 pairCount)',
  ),
  UNISWAP_V3: parseAbiItem(
    'event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)',
  ),
  UNISWAP_V4: parseAbiItem(
    'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
  ),
  AERODROME_STANDARD: parseAbiItem(
    'event PoolCreated(address indexed token0,address indexed token1,bool indexed stable,address pool,uint256 poolCount)',
  ),
  SLIPSTREAM: parseAbiItem(
    'event PoolCreated(address indexed token0,address indexed token1,int24 indexed tickSpacing,address pool)',
  ),
}

export interface RawRpcLog {
  readonly address: Address
  readonly blockHash: Hex
  readonly blockNumber: Hex
  readonly data: Hex
  readonly logIndex: Hex
  readonly removed?: boolean
  readonly topics: readonly Hex[]
  readonly transactionHash: Hex
}

export interface PoolFact {
  readonly schemaVersion: 1
  readonly id: string
  readonly chainId: number
  readonly sourceId: string
  readonly protocolId: string
  readonly venueId: string
  readonly eventKind: FactoryEventKind
  readonly poolIdentity: Hex
  readonly poolAddress: Address | null
  readonly token0: Address
  readonly token1: Address
  readonly feeUnit: 'BPS' | 'DYNAMIC' | 'PIPS' | 'PIPS_OR_DYNAMIC'
  readonly feeValue: number | null
  readonly tickSpacing: number | null
  readonly stable: boolean | null
  readonly hooks: Address | null
  readonly blockNumber: bigint
  readonly blockHash: Hex
  readonly transactionHash: Hex
  readonly logIndex: number
  readonly evidenceLevel: 'live_observed'
}

export interface FactoryEventSource {
  readonly id: string
  readonly chainId: number
  readonly address: Address
  readonly protocolId: string
  readonly venueId: string
  readonly kind: FactoryEventKind
  readonly event: AbiEvent
  readonly topic0: Hex
}

const SOURCE_KINDS: Readonly<Record<string, FactoryEventKind>> = {
  'base.uniswap-v2.factory': 'UNISWAP_V2',
  'base.uniswap-v3.factory': 'UNISWAP_V3',
  'base.uniswap-v4.pool-manager': 'UNISWAP_V4',
  'base.aerodrome.pool-factory': 'AERODROME_STANDARD',
  'base.aerodrome-slipstream.pool-factory': 'SLIPSTREAM',
  'base.aerodrome-slipstream.pool-factory-v2': 'SLIPSTREAM',
  'base.aerodrome-slipstream.pool-factory-v3': 'SLIPSTREAM',
  'base.pancakeswap-v3.factory': 'UNISWAP_V3',
  'robinhood.uniswap-v3.factory': 'UNISWAP_V3',
  'robinhood.uniswap-v4.pool-manager': 'UNISWAP_V4',
}

function sourceFromContract(contract: ContractDefinition): FactoryEventSource | null {
  const kind = SOURCE_KINDS[contract.id]
  if (kind === undefined || contract.venueId === null) return null
  const event = EVENTS[kind]
  return {
    id: contract.id,
    chainId: NETWORKS[contract.network].chainId,
    address: contract.address,
    protocolId: contract.protocolId,
    venueId: contract.venueId,
    kind,
    event,
    topic0: toEventSelector(event),
  }
}

export function eventSourcesForNetwork(network: NetworkId): readonly FactoryEventSource[] {
  return CONTRACTS.filter((contract) => contract.network === network)
    .map((contract) => sourceFromContract(contract))
    .filter((source): source is FactoryEventSource => source !== null)
}

function decodeArgs(source: FactoryEventSource, log: RawRpcLog): Record<string, unknown> {
  if (log.topics[0]?.toLowerCase() !== source.topic0.toLowerCase()) {
    throw new Error(`unexpected event topic for ${source.id}`)
  }
  const decoded = decodeEventLog({
    abi: [source.event],
    data: log.data,
    topics: [...log.topics] as [Hex, ...Hex[]],
    strict: true,
  })
  return decoded.args as unknown as Record<string, unknown>
}

function requiredAddress(args: Record<string, unknown>, field: string): Address {
  const value = args[field]
  if (typeof value !== 'string') throw new Error(`missing ${field}`)
  return getAddress(value)
}

function requiredNumber(args: Record<string, unknown>, field: string): number {
  const value = args[field]
  if (typeof value !== 'number') throw new Error(`missing ${field}`)
  return value
}

export function decodePoolFact(source: FactoryEventSource, log: RawRpcLog): PoolFact {
  if (log.removed === true) throw new Error('removed log cannot create a PoolFact')
  if (getAddress(log.address) !== source.address)
    throw new Error(`log source mismatch: ${source.id}`)
  const args = decodeArgs(source, log)
  const token0 = requiredAddress(args, source.kind === 'UNISWAP_V4' ? 'currency0' : 'token0')
  const token1 = requiredAddress(args, source.kind === 'UNISWAP_V4' ? 'currency1' : 'token1')

  let poolIdentity: Hex
  let poolAddress: Address | null
  let feeUnit: PoolFact['feeUnit']
  let feeValue: number | null = null
  let tickSpacing: number | null = null
  let stable: boolean | null = null
  let hooks: Address | null = null

  switch (source.kind) {
    case 'UNISWAP_V2':
      poolAddress = requiredAddress(args, 'pair')
      poolIdentity = poolAddress
      feeUnit = 'BPS'
      feeValue = 30
      break
    case 'UNISWAP_V3':
      poolAddress = requiredAddress(args, 'pool')
      poolIdentity = poolAddress
      feeUnit = 'PIPS'
      feeValue = requiredNumber(args, 'fee')
      tickSpacing = requiredNumber(args, 'tickSpacing')
      break
    case 'UNISWAP_V4': {
      const id = args.id
      if (typeof id !== 'string' || !/^0x[0-9a-f]{64}$/i.test(id)) throw new Error('missing id')
      poolIdentity = id as Hex
      poolAddress = null
      feeUnit = 'PIPS_OR_DYNAMIC'
      feeValue = requiredNumber(args, 'fee')
      tickSpacing = requiredNumber(args, 'tickSpacing')
      hooks = requiredAddress(args, 'hooks')
      break
    }
    case 'AERODROME_STANDARD':
      poolAddress = requiredAddress(args, 'pool')
      poolIdentity = poolAddress
      feeUnit = 'DYNAMIC'
      if (typeof args.stable !== 'boolean') throw new Error('missing stable')
      stable = args.stable
      break
    case 'SLIPSTREAM':
      poolAddress = requiredAddress(args, 'pool')
      poolIdentity = poolAddress
      feeUnit = 'DYNAMIC'
      tickSpacing = requiredNumber(args, 'tickSpacing')
      break
  }

  return {
    schemaVersion: 1,
    id: `${source.chainId}:${source.id}:${poolIdentity.toLowerCase()}`,
    chainId: source.chainId,
    sourceId: source.id,
    protocolId: source.protocolId,
    venueId: source.venueId,
    eventKind: source.kind,
    poolIdentity,
    poolAddress,
    token0,
    token1,
    feeUnit,
    feeValue,
    tickSpacing,
    stable,
    hooks,
    blockNumber: BigInt(log.blockNumber),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: Number(BigInt(log.logIndex)),
    evidenceLevel: 'live_observed',
  }
}
