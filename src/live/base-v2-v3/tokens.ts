import { getAddress, type Address } from 'viem'

export interface BaseCanaryToken {
  readonly symbol: string
  readonly name: string
  readonly address: Address
  readonly decimals: number
  readonly policyTier: 'CORE' | 'ESTABLISHED_VOLATILE'
  readonly source: string
}

const UNISWAP_BASE_LIST_SOURCE =
  'https://github.com/Uniswap/default-token-list/blob/2f7d74d9aa5c7903a235ee728d12724bea9cfb2a/src/tokens/base.json'

const token = (
  symbol: string,
  name: string,
  value: string,
  decimals: number,
  policyTier: BaseCanaryToken['policyTier'],
): BaseCanaryToken => ({
  symbol,
  name,
  address: getAddress(value),
  decimals,
  policyTier,
  source: UNISWAP_BASE_LIST_SOURCE,
})

/**
 * This is an explicit capital-bearing allowlist, not a discovery list. A token
 * discovered elsewhere remains shadow-only until it is reviewed and added
 * here, then separately approved on the deployed executor while disarmed.
 */
export const BASE_CANARY_TOKENS: readonly BaseCanaryToken[] = [
  token('USDC', 'USD Coin', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'CORE'),
  token('USDbC', 'USD Base Coin', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', 6, 'CORE'),
  token(
    'cbETH',
    'Coinbase Wrapped Staked ETH',
    '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
    18,
    'CORE',
  ),
  token('DAI', 'Dai Stablecoin', '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 18, 'CORE'),
  token('cbBTC', 'Coinbase Wrapped BTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', 8, 'CORE'),
  token(
    'AERO',
    'Aerodrome Finance',
    '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    18,
    'ESTABLISHED_VOLATILE',
  ),
  token('DEGEN', 'Degen', '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', 18, 'ESTABLISHED_VOLATILE'),
  token('TOSHI', 'Toshi', '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4', 18, 'ESTABLISHED_VOLATILE'),
  token(
    'VIRTUAL',
    'Virtuals Protocol',
    '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
    18,
    'ESTABLISHED_VOLATILE',
  ),
  token(
    'AIXBT',
    'aixbt by Virtuals',
    '0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825',
    18,
    'ESTABLISHED_VOLATILE',
  ),
]
