import { createPublicClient, fallback, http, type FallbackTransport, type PublicClient } from 'viem'
import { base } from 'viem/chains'

export type BaseReadClient = PublicClient<FallbackTransport, typeof base>

export function createBaseReadClient(configuredEndpoint?: string): BaseReadClient {
  const endpoints = [
    configuredEndpoint,
    'https://mainnet.base.org',
    'https://base-rpc.publicnode.com',
  ]
    .filter((value): value is string => value !== undefined && value !== '')
    .filter((value, index, values) => values.indexOf(value) === index)
  return createPublicClient({
    chain: base,
    transport: fallback(endpoints.map((endpoint) => http(endpoint))),
  })
}
