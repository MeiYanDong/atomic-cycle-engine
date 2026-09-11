import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'

import type { ReadOnlyRpcClient } from '../rpc/read-only-client.js'

const FACTORY_REGISTRY_ABI = parseAbi([
  'function poolFactories() view returns (address[])',
  'function isPoolFactoryApproved(address poolFactory) view returns (bool)',
])

export async function readAerodromePoolFactories(
  client: ReadOnlyRpcClient,
  registryAddress: Address,
  blockTag: Hex,
): Promise<readonly Address[]> {
  const data = encodeFunctionData({
    abi: FACTORY_REGISTRY_ABI,
    functionName: 'poolFactories',
  })
  const encoded = await client.request<Hex>('eth_call', [{ to: registryAddress, data }, blockTag])
  const decoded = decodeFunctionResult({
    abi: FACTORY_REGISTRY_ABI,
    functionName: 'poolFactories',
    data: encoded,
  })
  const factories = decoded.map((factory) => getAddress(factory))
  if (factories.length === 0) throw new Error('Aerodrome FactoryRegistry returned no factories')
  if (new Set(factories.map((factory) => factory.toLowerCase())).size !== factories.length) {
    throw new Error('Aerodrome FactoryRegistry returned duplicate factories')
  }
  return factories
}
