import { getAddress, parseUnits } from 'viem'

import { CONTRACTS, NETWORKS, type ContractDefinition } from '../config/registry.js'
import type { CrossVenueProfile, ShadowToken, ShadowVenue } from './cross-venue.js'

function contract(id: string): ContractDefinition {
  const match = CONTRACTS.find((definition) => definition.id === id)
  if (match === undefined) throw new Error(`missing shadow contract definition: ${id}`)
  return match
}

function token(symbol: string, value: string, decimals: number): ShadowToken {
  return { symbol, address: getAddress(value), decimals }
}

function v2(id: string, label: string, routerId: string): ShadowVenue {
  return { id, label, kind: 'V2_ROUTER', router: contract(routerId).address }
}

function v3(
  id: string,
  label: string,
  factoryId: string,
  quoterId: string,
  feeTiers: readonly number[],
): ShadowVenue {
  return {
    id,
    label,
    kind: 'V3_QUOTER_V2',
    factory: contract(factoryId).address,
    quoter: contract(quoterId).address,
    feeTiers,
  }
}

const ROBINHOOD_WETH = token('WETH', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', 18)
const BNB_WBNB = token('WBNB', '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 18)

export const CROSS_VENUE_PROFILES: readonly CrossVenueProfile[] = [
  {
    network: 'robinhood',
    chainId: NETWORKS.robinhood.chainId,
    baseAsset: ROBINHOOD_WETH,
    targets: [
      token('USDG', '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', 6),
      token('AI', '0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18', 18),
      token('MOO', '0xD9dB30BB0D2b8d2eae3826A1372117E058791e18', 18),
    ],
    venues: [
      v2('UNISWAP_V2', 'Uniswap V2', 'robinhood.uniswap-v2.router'),
      v2('PANCAKESWAP_V2', 'PancakeSwap V2', 'robinhood.pancakeswap-v2.router'),
      v3(
        'UNISWAP_V3',
        'Uniswap V3',
        'robinhood.uniswap-v3.factory',
        'robinhood.uniswap-v3.quoter',
        [100, 500, 3_000, 10_000],
      ),
      v3(
        'PANCAKESWAP_V3',
        'PancakeSwap V3',
        'robinhood.pancakeswap-v3.factory',
        'robinhood.pancakeswap-v3.quoter-v2',
        [100, 500, 2_500, 10_000],
      ),
    ],
    amountsIn: [parseUnits('0.0005', 18), parseUnits('0.002', 18)],
    conservativeGasUnits: 600_000n,
    riskBufferBps: 10n,
  },
  {
    network: 'bnb',
    chainId: NETWORKS.bnb.chainId,
    baseAsset: BNB_WBNB,
    targets: [
      token('USDT', '0x55d398326f99059fF775485246999027B3197955', 18),
      token('USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18),
      token('FDUSD', '0xc5f0f7B66764F6EC8C8Dff7ba683102295E16409', 18),
    ],
    venues: [
      v2('PANCAKESWAP_V2', 'PancakeSwap V2', 'bnb.pancakeswap-v2.router'),
      v2('UNISWAP_V2', 'Uniswap V2', 'bnb.uniswap-v2.router'),
      v3(
        'PANCAKESWAP_V3',
        'PancakeSwap V3',
        'bnb.pancakeswap-v3.factory',
        'bnb.pancakeswap-v3.quoter-v2',
        [100, 500, 2_500, 10_000],
      ),
      v3(
        'UNISWAP_V3',
        'Uniswap V3',
        'bnb.uniswap-v3.factory',
        'bnb.uniswap-v3.quoter-v2',
        [100, 500, 3_000, 10_000],
      ),
    ],
    amountsIn: [parseUnits('0.0025', 18), parseUnits('0.01', 18)],
    conservativeGasUnits: 600_000n,
    riskBufferBps: 10n,
  },
]

export function profileForNetwork(network: 'robinhood' | 'bnb'): CrossVenueProfile {
  const profile = CROSS_VENUE_PROFILES.find((candidate) => candidate.network === network)
  if (profile === undefined) throw new Error(`missing cross-venue profile: ${network}`)
  return profile
}
