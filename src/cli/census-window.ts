import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { NETWORKS, type NetworkId } from '../config/registry.js'
import { eventSourcesForNetwork } from '../discovery/factory-events.js'
import { scanDiscoveryWindow } from '../discovery/window-scan.js'
import { sanitizeEvidence } from '../evidence/jsonl-store.js'
import { ReadOnlyRpcClient } from '../rpc/read-only-client.js'

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index < 0 ? undefined : argv[index + 1]
}

function parseNetwork(argv: readonly string[]): NetworkId {
  const value = argument(argv, '--network')
  if (value !== 'base' && value !== 'robinhood' && value !== 'bnb') {
    throw new Error(
      'usage: npm run census:window -- --network base|robinhood|bnb [--blocks 250] [--chunk-size 250] [--output path]',
    )
  }
  return value
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${label} must be an integer in [${minimum}, ${maximum}]`)
  }
  return parsed
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const networkId = parseNetwork(argv)
  const blockCount = boundedInteger(argument(argv, '--blocks'), 250, 1, 5_000, '--blocks')
  const chunkSize = boundedInteger(argument(argv, '--chunk-size'), 250, 1, 1_000, '--chunk-size')
  const network = NETWORKS[networkId]
  const envName = {
    base: 'BASE_READ_RPC_URL',
    robinhood: 'ROBINHOOD_READ_RPC_URL',
    bnb: 'BNB_READ_RPC_URL',
  }[networkId]
  const client = new ReadOnlyRpcClient(process.env[envName] ?? network.publicHttpRpc)
  const chainId = BigInt(await client.request<string>('eth_chainId'))
  const head = BigInt(await client.request<string>('eth_blockNumber'))
  const fromBlock = head >= BigInt(blockCount - 1) ? head - BigInt(blockCount - 1) : 0n
  const sources = eventSourcesForNetwork(networkId)
  const scan = await scanDiscoveryWindow({
    client,
    sources,
    fromBlock,
    throughBlock: head,
    chunkSize: BigInt(chunkSize),
  })
  const report = sanitizeEvidence({
    schemaVersion: 1,
    kind: 'bounded_discovery_window',
    observedAt: new Date().toISOString(),
    evidenceLevel: 'live_observed',
    network: networkId,
    expectedChainId: network.chainId,
    observedChainId: chainId,
    endpoint: client.endpointLabel,
    requestedBlockCount: blockCount,
    chunkSize,
    sourceCount: sources.length,
    ...scan,
  })
  const rendered = `${JSON.stringify(report, null, 2)}\n`
  const targetArgument = argument(argv, '--output')
  if (targetArgument !== undefined) {
    const target = resolve(targetArgument)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, rendered, { encoding: 'utf8', mode: 0o600 })
  }
  process.stdout.write(rendered)
  if (chainId !== BigInt(network.chainId) || scan.status !== 'COMPLETE') process.exitCode = 1
}

await main()
