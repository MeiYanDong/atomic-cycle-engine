import { getAddress, type Address } from 'viem'

import type { AssetRef, QuoteEdge, SourceProvenance, StateReference } from '../src/domain/types.js'

export function testAddress(index: number): Address {
  return getAddress(`0x${index.toString(16).padStart(40, '0')}`)
}

export function asset(index: number, symbol: string, chainId = 8453): AssetRef {
  return { chainId, address: testAddress(index), symbol, decimals: 18 }
}

export const provenance: SourceProvenance = {
  discoverySource: {
    id: 'CHAIN_LOG',
    status: 'CHAIN_ATTESTED',
    evidenceRefs: ['fixture:discovery'],
  },
  launchPlatform: { id: null, status: 'UNKNOWN', evidenceRefs: [] },
  launchProtocol: { id: null, status: 'UNKNOWN', evidenceRefs: [] },
  liquidityVenue: {
    id: 'TEST_VENUE',
    status: 'CHAIN_ATTESTED',
    evidenceRefs: ['fixture:venue'],
  },
}

export function edge(input: {
  readonly id: string
  readonly source: string
  readonly tokenIn: AssetRef
  readonly tokenOut: AssetRef
  readonly adapterId?: string
}): QuoteEdge {
  return {
    id: input.id,
    chainId: input.tokenIn.chainId,
    adapterId: input.adapterId ?? 'fixture',
    liquiditySourceId: input.source,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    provenance,
  }
}

export const fixtureState: StateReference = {
  chainId: 8453,
  basis: 'SYNTHETIC_FIXTURE',
  value: 'fixture-1',
  commitment: 'sha256:fixture-1',
}
