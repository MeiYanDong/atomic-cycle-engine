import type { Hex } from 'viem'

import type { ReadOnlyRpcClient } from '../rpc/read-only-client.js'
import {
  decodePoolFact,
  type FactoryEventSource,
  type PoolFact,
  type RawRpcLog,
} from './factory-events.js'

export interface SourceWindowCoverage {
  readonly sourceId: string
  readonly fromBlock: bigint
  readonly throughBlock: bigint
  readonly status: 'COMPLETE' | 'GAPPED'
  readonly requestCount: number
  readonly logCount: number
  readonly gaps: readonly {
    readonly fromBlock: bigint
    readonly toBlock: bigint
    readonly error: string
  }[]
}

export interface DiscoveryWindowResult {
  readonly fromBlock: bigint
  readonly throughBlock: bigint
  readonly status: 'COMPLETE' | 'GAPPED'
  readonly facts: readonly PoolFact[]
  readonly coverage: readonly SourceWindowCoverage[]
}

function blockHex(block: bigint): Hex {
  return `0x${block.toString(16)}`
}

export async function scanDiscoveryWindow(input: {
  readonly client: ReadOnlyRpcClient
  readonly sources: readonly FactoryEventSource[]
  readonly fromBlock: bigint
  readonly throughBlock: bigint
  readonly chunkSize: bigint
}): Promise<DiscoveryWindowResult> {
  if (input.fromBlock < 0n || input.throughBlock < input.fromBlock || input.chunkSize <= 0n) {
    throw new RangeError('invalid discovery window')
  }

  const facts: PoolFact[] = []
  const coverage: SourceWindowCoverage[] = []
  for (const source of input.sources) {
    const sourceFacts: PoolFact[] = []
    const gaps: SourceWindowCoverage['gaps'][number][] = []
    let requestCount = 0
    for (let from = input.fromBlock; from <= input.throughBlock; from += input.chunkSize) {
      const to =
        from + input.chunkSize - 1n < input.throughBlock
          ? from + input.chunkSize - 1n
          : input.throughBlock
      requestCount += 1
      try {
        const logs = await input.client.request<readonly RawRpcLog[]>('eth_getLogs', [
          {
            address: source.address,
            topics: [source.topic0],
            fromBlock: blockHex(from),
            toBlock: blockHex(to),
          },
        ])
        sourceFacts.push(...logs.map((log) => decodePoolFact(source, log)))
      } catch (error) {
        gaps.push({
          fromBlock: from,
          toBlock: to,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    facts.push(...sourceFacts)
    coverage.push({
      sourceId: source.id,
      fromBlock: input.fromBlock,
      throughBlock: input.throughBlock,
      status: gaps.length === 0 ? 'COMPLETE' : 'GAPPED',
      requestCount,
      logCount: sourceFacts.length,
      gaps,
    })
  }

  const uniqueFacts = new Map(facts.map((fact) => [fact.id, fact]))
  return {
    fromBlock: input.fromBlock,
    throughBlock: input.throughBlock,
    status: coverage.every((item) => item.status === 'COMPLETE') ? 'COMPLETE' : 'GAPPED',
    facts: [...uniqueFacts.values()].sort((left, right) => left.id.localeCompare(right.id)),
    coverage,
  }
}
