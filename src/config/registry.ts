import { getAddress, type Address } from 'viem'

import type { EvidenceLevel } from '../domain/types.js'

export type NetworkId = 'base' | 'robinhood'
export type ContractSupport = 'DISCOVERY_ONLY' | 'PLANNED_ADAPTER' | 'REGISTRY_ONLY'

export interface NetworkDefinition {
  readonly id: NetworkId
  readonly name: string
  readonly chainId: number
  readonly publicHttpRpc: string
  readonly publicWebSocketRpc?: string
  readonly pendingStateHttpRpc?: string
  readonly pendingStateWebSocketRpc?: string
  readonly rpcEvidenceUrl: string
  readonly notes: readonly string[]
}

export interface ContractDefinition {
  readonly id: string
  readonly network: NetworkId
  readonly protocolId: string
  readonly venueId: string | null
  readonly platformId: string | null
  readonly role: string
  readonly address: Address
  readonly support: ContractSupport
  readonly evidenceLevel: EvidenceLevel
  readonly evidenceUrl: string
}

const address = (value: string): Address => getAddress(value)

export const NETWORKS: Readonly<Record<NetworkId, NetworkDefinition>> = {
  base: {
    id: 'base',
    name: 'Base Mainnet',
    chainId: 8453,
    publicHttpRpc: 'https://mainnet.base.org',
    publicWebSocketRpc: 'wss://mainnet.base.org',
    pendingStateHttpRpc: 'https://mainnet-preconf.base.org',
    pendingStateWebSocketRpc: 'wss://mainnet-preconf.base.org',
    rpcEvidenceUrl: 'https://docs.base.org/base-chain/api-reference/rpc-overview',
    notes: [
      'The official public endpoint is rate limited and is not a production SLA.',
      'Flashblocks pending state is a separate capability and must retain its sequence identity.',
    ],
  },
  robinhood: {
    id: 'robinhood',
    name: 'Robinhood Chain Mainnet',
    chainId: 4663,
    publicHttpRpc: 'https://rpc.mainnet.chain.robinhood.com',
    rpcEvidenceUrl: 'https://docs.robinhood.com/crypto/Robinhood-Chain/overview/',
    notes: [
      'Initial contract identities are repository records from the existing Robinhood engine.',
      'PAIR and LONG_ROUTE remain discovery/platform dimensions, never implicit venue identities.',
    ],
  },
}

const UNISWAP_V3_BASE_SOURCE =
  'https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments'
const UNISWAP_V4_SOURCE = 'https://developers.uniswap.org/docs/protocols/v4/deployments'
const AERODROME_SOURCE = 'https://aerodrome.finance/security'
const AERODROME_REGISTRY_SOURCE =
  'https://github.com/aerodrome-finance/contracts/blob/main/contracts/FactoryRegistry.sol'
const PANCAKE_V3_SOURCE = 'https://developer.pancakeswap.finance/contracts/v3/addresses'
const RH_REPOSITORY_SOURCE = 'https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/tree/main'

export const CONTRACTS: readonly ContractDefinition[] = [
  {
    id: 'base.uniswap-v2.factory',
    network: 'base',
    protocolId: 'UNISWAP_V2',
    venueId: 'UNISWAP_V2',
    platformId: null,
    role: 'POOL_FACTORY',
    address: address('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: 'https://github.com/Uniswap/util-contracts',
  },
  {
    id: 'base.uniswap-v3.factory',
    network: 'base',
    protocolId: 'UNISWAP_V3',
    venueId: 'UNISWAP_V3',
    platformId: null,
    role: 'POOL_FACTORY',
    address: address('0x33128a8fC17869897dcE68Ed026d694621f6FDfD'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: UNISWAP_V3_BASE_SOURCE,
  },
  {
    id: 'base.uniswap-v3.quoter-v2',
    network: 'base',
    protocolId: 'UNISWAP_V3',
    venueId: 'UNISWAP_V3',
    platformId: null,
    role: 'QUOTER',
    address: address('0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: UNISWAP_V3_BASE_SOURCE,
  },
  {
    id: 'base.uniswap-v3.swap-router-02',
    network: 'base',
    protocolId: 'UNISWAP_V3',
    venueId: 'UNISWAP_V3',
    platformId: null,
    role: 'ROUTER',
    address: address('0x2626664c2603336E57B271c5C0b26F421741e481'),
    support: 'REGISTRY_ONLY',
    evidenceLevel: 'configured',
    evidenceUrl: UNISWAP_V3_BASE_SOURCE,
  },
  {
    id: 'base.uniswap-v4.pool-manager',
    network: 'base',
    protocolId: 'UNISWAP_V4',
    venueId: 'UNISWAP_V4',
    platformId: null,
    role: 'POOL_MANAGER',
    address: address('0x498581ff718922c3f8e6a244956af099b2652b2b'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: UNISWAP_V4_SOURCE,
  },
  {
    id: 'base.uniswap-v4.quoter',
    network: 'base',
    protocolId: 'UNISWAP_V4',
    venueId: 'UNISWAP_V4',
    platformId: null,
    role: 'QUOTER',
    address: address('0x0d5e0f971ed27fbff6c2837bf31316121532048d'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: UNISWAP_V4_SOURCE,
  },
  {
    id: 'base.uniswap-v4.state-view',
    network: 'base',
    protocolId: 'UNISWAP_V4',
    venueId: 'UNISWAP_V4',
    platformId: null,
    role: 'STATE_VIEW',
    address: address('0xa3c0c9b65bad0b08107aa264b0f3db444b867a71'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: UNISWAP_V4_SOURCE,
  },
  {
    id: 'base.uniswap-v4.universal-router',
    network: 'base',
    protocolId: 'UNISWAP_V4',
    venueId: 'UNISWAP_V4',
    platformId: null,
    role: 'ROUTER',
    address: address('0x6ff5693b99212da76ad316178a184ab56d299b43'),
    support: 'REGISTRY_ONLY',
    evidenceLevel: 'configured',
    evidenceUrl: UNISWAP_V4_SOURCE,
  },
  {
    id: 'base.aerodrome.factory-registry',
    network: 'base',
    protocolId: 'AERODROME',
    venueId: null,
    platformId: null,
    role: 'FACTORY_REGISTRY',
    address: address('0x5C3F18F06CC09CA1910767A34a20F771039E37C0'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: AERODROME_REGISTRY_SOURCE,
  },
  {
    id: 'base.aerodrome.pool-factory',
    network: 'base',
    protocolId: 'AERODROME',
    venueId: 'AERODROME_STANDARD',
    platformId: null,
    role: 'POOL_FACTORY',
    address: address('0x420DD381b31aEf6683db6B902084cB0FFECe40Da'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: AERODROME_SOURCE,
  },
  {
    id: 'base.aerodrome.router',
    network: 'base',
    protocolId: 'AERODROME',
    venueId: 'AERODROME_STANDARD',
    platformId: null,
    role: 'ROUTER',
    address: address('0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'),
    support: 'REGISTRY_ONLY',
    evidenceLevel: 'configured',
    evidenceUrl: AERODROME_SOURCE,
  },
  {
    id: 'base.aerodrome-slipstream.pool-factory',
    network: 'base',
    protocolId: 'AERODROME_SLIPSTREAM',
    venueId: 'AERODROME_SLIPSTREAM',
    platformId: null,
    role: 'POOL_FACTORY',
    address: address('0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: AERODROME_SOURCE,
  },
  {
    id: 'base.aerodrome-slipstream.pool-factory-v2',
    network: 'base',
    protocolId: 'AERODROME_SLIPSTREAM',
    venueId: 'AERODROME_SLIPSTREAM',
    platformId: null,
    role: 'POOL_FACTORY',
    address: address('0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'live_observed',
    evidenceUrl: AERODROME_REGISTRY_SOURCE,
  },
  {
    id: 'base.aerodrome-slipstream.pool-factory-v3',
    network: 'base',
    protocolId: 'AERODROME_SLIPSTREAM',
    venueId: 'AERODROME_SLIPSTREAM',
    platformId: null,
    role: 'POOL_FACTORY',
    address: address('0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'live_observed',
    evidenceUrl: AERODROME_REGISTRY_SOURCE,
  },
  {
    id: 'base.aerodrome-slipstream.quoter',
    network: 'base',
    protocolId: 'AERODROME_SLIPSTREAM',
    venueId: 'AERODROME_SLIPSTREAM',
    platformId: null,
    role: 'QUOTER',
    address: address('0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'configured',
    evidenceUrl: AERODROME_SOURCE,
  },
  {
    id: 'base.aerodrome-slipstream.swap-router',
    network: 'base',
    protocolId: 'AERODROME_SLIPSTREAM',
    venueId: 'AERODROME_SLIPSTREAM',
    platformId: null,
    role: 'ROUTER',
    address: address('0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5'),
    support: 'REGISTRY_ONLY',
    evidenceLevel: 'configured',
    evidenceUrl: AERODROME_SOURCE,
  },
  {
    id: 'base.pancakeswap-v3.factory',
    network: 'base',
    protocolId: 'PANCAKESWAP_V3',
    venueId: 'PANCAKESWAP_V3',
    platformId: null,
    role: 'POOL_FACTORY',
    address: address('0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'),
    support: 'REGISTRY_ONLY',
    evidenceLevel: 'configured',
    evidenceUrl: PANCAKE_V3_SOURCE,
  },
  {
    id: 'robinhood.uniswap-v3.factory',
    network: 'robinhood',
    protocolId: 'UNISWAP_V3',
    venueId: 'UNISWAP_V3',
    platformId: null,
    role: 'POOL_FACTORY',
    address: address('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'repository_record',
    evidenceUrl: RH_REPOSITORY_SOURCE,
  },
  {
    id: 'robinhood.uniswap-v3.quoter',
    network: 'robinhood',
    protocolId: 'UNISWAP_V3',
    venueId: 'UNISWAP_V3',
    platformId: null,
    role: 'QUOTER',
    address: address('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'repository_record',
    evidenceUrl: RH_REPOSITORY_SOURCE,
  },
  {
    id: 'robinhood.uniswap-v3.router',
    network: 'robinhood',
    protocolId: 'UNISWAP_V3',
    venueId: 'UNISWAP_V3',
    platformId: null,
    role: 'ROUTER',
    address: address('0xCaf681a66D020601342297493863E78C959E5cb2'),
    support: 'REGISTRY_ONLY',
    evidenceLevel: 'repository_record',
    evidenceUrl: RH_REPOSITORY_SOURCE,
  },
  {
    id: 'robinhood.uniswap-v4.pool-manager',
    network: 'robinhood',
    protocolId: 'UNISWAP_V4',
    venueId: 'UNISWAP_V4',
    platformId: null,
    role: 'POOL_MANAGER',
    address: address('0x8366a39CC670B4001A1121B8F6A443A643e40951'),
    support: 'PLANNED_ADAPTER',
    evidenceLevel: 'repository_record',
    evidenceUrl: RH_REPOSITORY_SOURCE,
  },
  {
    id: 'robinhood.long.launcher',
    network: 'robinhood',
    protocolId: 'DOPPLER',
    venueId: null,
    platformId: 'LONG_ROUTE',
    role: 'UNIQUE_PLATFORM_ENTRY',
    address: address('0x22e99278308b393ea1260859b181ad7e78f5eeed'),
    support: 'DISCOVERY_ONLY',
    evidenceLevel: 'repository_record',
    evidenceUrl: RH_REPOSITORY_SOURCE,
  },
  {
    id: 'robinhood.pair.hook',
    network: 'robinhood',
    protocolId: 'UNKNOWN',
    venueId: 'UNISWAP_V4',
    platformId: 'PAIR',
    role: 'PLATFORM_LIQUIDITY_HOOK',
    address: address('0x16D1560630Ce74af4478d9b8AD46548A092A2000'),
    support: 'DISCOVERY_ONLY',
    evidenceLevel: 'repository_record',
    evidenceUrl: RH_REPOSITORY_SOURCE,
  },
  {
    id: 'robinhood.pair.hook-v2-observed',
    network: 'robinhood',
    protocolId: 'UNKNOWN',
    venueId: 'UNISWAP_V4',
    platformId: 'PAIR',
    role: 'PLATFORM_LIQUIDITY_HOOK',
    address: address('0xD2F759A1Cf13c30127C551c3aEe04629Aea200c0'),
    support: 'DISCOVERY_ONLY',
    evidenceLevel: 'repository_record',
    evidenceUrl: RH_REPOSITORY_SOURCE,
  },
]

export function contractsForNetwork(network: NetworkId): readonly ContractDefinition[] {
  return CONTRACTS.filter((contract) => contract.network === network)
}

export function assertRegistry(): void {
  const ids = new Set<string>()
  const identities = new Set<string>()
  for (const contract of CONTRACTS) {
    if (ids.has(contract.id)) throw new Error(`duplicate contract id: ${contract.id}`)
    ids.add(contract.id)
    const identity = `${NETWORKS[contract.network].chainId}:${contract.address.toLowerCase()}:${contract.role}`
    if (identities.has(identity)) throw new Error(`duplicate contract identity: ${identity}`)
    identities.add(identity)
    if (contract.platformId !== null && contract.venueId === contract.platformId) {
      throw new Error(`platform and venue were collapsed: ${contract.id}`)
    }
  }
}
