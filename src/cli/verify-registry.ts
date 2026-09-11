import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  assertRegistry,
  contractsForNetwork,
  NETWORKS,
  type NetworkId,
} from '../config/registry.js'
import { sanitizeEvidence } from '../evidence/jsonl-store.js'
import { ReadOnlyRpcClient } from '../rpc/read-only-client.js'

interface VerificationResult {
  readonly contractId: string
  readonly address: string
  readonly status: 'CODE_PRESENT' | 'NO_CODE' | 'UNKNOWN'
  readonly codeBytes: number | null
  readonly error?: string
}

function parseNetwork(argv: readonly string[]): NetworkId {
  const index = argv.indexOf('--network')
  const value = index >= 0 ? argv[index + 1] : undefined
  if (value !== 'base' && value !== 'robinhood') {
    throw new Error('usage: npm run registry:verify -- --network base|robinhood [--output path]')
  }
  return value
}

function outputPath(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--output')
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error('--output requires a path')
  return resolve(value)
}

function hexToBigInt(value: string): bigint {
  if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error(`invalid RPC hex value: ${value}`)
  return BigInt(value)
}

async function main(): Promise<void> {
  assertRegistry()
  const networkId = parseNetwork(process.argv.slice(2))
  const network = NETWORKS[networkId]
  const envName = networkId === 'base' ? 'BASE_READ_RPC_URL' : 'ROBINHOOD_READ_RPC_URL'
  const client = new ReadOnlyRpcClient(process.env[envName] ?? network.publicHttpRpc)
  const chainId = hexToBigInt(await client.request<string>('eth_chainId'))
  const blockNumber = hexToBigInt(await client.request<string>('eth_blockNumber'))
  const results: VerificationResult[] = []

  for (const contract of contractsForNetwork(networkId)) {
    try {
      const code = await client.request<string>('eth_getCode', [contract.address, 'latest'])
      const codeBytes = code === '0x' ? 0 : (code.length - 2) / 2
      results.push({
        contractId: contract.id,
        address: contract.address,
        status: codeBytes > 0 ? 'CODE_PRESENT' : 'NO_CODE',
        codeBytes,
      })
    } catch (error) {
      results.push({
        contractId: contract.id,
        address: contract.address,
        status: 'UNKNOWN',
        codeBytes: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const report = sanitizeEvidence({
    schemaVersion: 1,
    kind: 'registry_verification',
    observedAt: new Date().toISOString(),
    evidenceLevel: 'live_observed',
    network: networkId,
    expectedChainId: network.chainId,
    observedChainId: chainId,
    blockNumber,
    endpoint: client.endpointLabel,
    boundedRequestCount: results.length + 2,
    contracts: results,
  })
  const rendered = `${JSON.stringify(report, null, 2)}\n`
  const target = outputPath(process.argv.slice(2))
  if (target !== undefined) {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, rendered, { encoding: 'utf8', mode: 0o600 })
  }
  process.stdout.write(rendered)

  if (
    chainId !== BigInt(network.chainId) ||
    results.some((item) => item.status !== 'CODE_PRESENT')
  ) {
    process.exitCode = 1
  }
}

await main()
