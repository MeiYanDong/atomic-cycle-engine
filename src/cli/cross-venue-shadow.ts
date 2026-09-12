import { setTimeout as delay } from 'node:timers/promises'
import type { Hash, Hex } from 'viem'

import { NETWORKS } from '../config/registry.js'
import { ReadOnlyRpcClient } from '../rpc/read-only-client.js'
import {
  buildPublicShadowSnapshot,
  writePublicShadowSnapshot,
  type ShadowNetworkObservation,
} from '../shadow/public-snapshot.js'
import { profileForNetwork } from '../shadow/profiles.js'
import { createRpcDirectQuote, type RpcQuoteStats } from '../shadow/rpc-quote.js'
import { scanCrossVenueProfile, type ShadowState } from '../shadow/cross-venue.js'

type ShadowNetwork = 'robinhood' | 'bnb'

interface RpcBlock {
  readonly number: Hex | null
  readonly hash: Hash | null
}

const EMPTY_STATS: RpcQuoteStats = {
  logicalQuotes: 0,
  rpcCalls: 0,
  failedRpcCalls: 0,
  unavailableQuotes: 0,
}

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function selectedNetworks(argv: readonly string[]): readonly ShadowNetwork[] {
  const value = argument(argv, '--network') ?? 'all'
  if (value === 'all') return ['robinhood', 'bnb']
  if (value === 'robinhood' || value === 'bnb') return [value]
  throw new Error('--network must be robinhood, bnb, or all')
}

function outputPath(argv: readonly string[]): string {
  return argument(argv, '--output') ?? '/var/lib/atomic-cycle-shadow/public.json'
}

function intervalMilliseconds(argv: readonly string[]): number {
  const raw = argument(argv, '--interval-seconds') ?? '120'
  const seconds = Number(raw)
  if (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 900) {
    throw new Error('--interval-seconds must be an integer from 30 through 900')
  }
  return seconds * 1_000
}

function fromHex(value: Hex, label: string): bigint {
  if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error(`invalid ${label}`)
  return BigInt(value)
}

function fixedBlockTag(blockNumber: bigint): Hex {
  return `0x${blockNumber.toString(16)}`
}

async function readShadowState(
  client: ReadOnlyRpcClient,
  expectedChainId: number,
): Promise<ShadowState> {
  const [chainHex, block, gasPriceHex] = await Promise.all([
    client.request<Hex>('eth_chainId'),
    client.request<RpcBlock>('eth_getBlockByNumber', ['latest', false]),
    client.request<Hex>('eth_gasPrice'),
  ])
  const chainId = fromHex(chainHex, 'chain id')
  if (chainId !== BigInt(expectedChainId)) throw new Error('RPC chain identity mismatch')
  if (block.number === null || block.hash === null)
    throw new Error('latest block identity unavailable')
  return {
    blockNumber: fromHex(block.number, 'block number'),
    blockHash: block.hash,
    gasPrice: fromHex(gasPriceHex, 'gas price'),
  }
}

async function stillCanonical(client: ReadOnlyRpcClient, state: ShadowState): Promise<boolean> {
  const block = await client.request<RpcBlock>('eth_getBlockByNumber', [
    fixedBlockTag(state.blockNumber),
    false,
  ])
  return block.hash?.toLowerCase() === state.blockHash.toLowerCase()
}

async function scanNetwork(network: ShadowNetwork): Promise<ShadowNetworkObservation> {
  const profile = profileForNetwork(network)
  const endpointVariable = network === 'bnb' ? 'BNB_READ_RPC_URL' : 'ROBINHOOD_READ_RPC_URL'
  const client = new ReadOnlyRpcClient(
    process.env[endpointVariable] ?? NETWORKS[network].publicHttpRpc,
  )
  const adapter = createRpcDirectQuote(client)
  try {
    const state = await readShadowState(client, profile.chainId)
    const scan = await scanCrossVenueProfile({ profile, state, quote: adapter.quote })
    if (!(await stillCanonical(client, state))) {
      return {
        profile,
        observedAt: new Date().toISOString(),
        scan: null,
        quoteStats: adapter.stats(),
        reasonCode: 'REORG_DETECTED',
      }
    }
    return {
      profile,
      observedAt: new Date().toISOString(),
      scan,
      quoteStats: adapter.stats(),
      reasonCode: 'NONE',
    }
  } catch {
    return {
      profile,
      observedAt: new Date().toISOString(),
      scan: null,
      quoteStats: adapter.stats().rpcCalls === 0 ? EMPTY_STATS : adapter.stats(),
      reasonCode: 'RPC_OR_QUOTE_UNAVAILABLE',
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const networks = selectedNetworks(argv)
  const target = outputPath(argv)
  const interval = intervalMilliseconds(argv)
  const once = argv.includes('--once')
  const shutdown = new AbortController()
  process.once('SIGINT', () => shutdown.abort())
  process.once('SIGTERM', () => shutdown.abort())

  do {
    const observations = await Promise.all(networks.map(scanNetwork))
    const snapshot = buildPublicShadowSnapshot(observations)
    await writePublicShadowSnapshot(target, snapshot)
    process.stdout.write(
      `${JSON.stringify({
        observedAt: snapshot.generatedAt,
        mode: snapshot.mode,
        networks: snapshot.networks.map((network) => ({
          id: network.id,
          status: network.status,
          fullyQuotedCycles: network.funnel.fullyQuotedCycles,
          gasAdjustedPositiveCycles: network.funnel.gasAdjustedPositiveCycles,
        })),
      })}\n`,
    )
    if (once) {
      if (observations.every((observation) => observation.scan === null)) process.exitCode = 1
      break
    }
    await delay(interval, undefined, { signal: shutdown.signal }).catch((error) => {
      if (!shutdown.signal.aborted) throw error
    })
  } while (!shutdown.signal.aborted)
}

await main()
