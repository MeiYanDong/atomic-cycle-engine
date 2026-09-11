import { getAddress, type Address } from 'viem'

export interface BaseLivePolicy {
  readonly liveArm: boolean
  readonly authorizationId: string | null
  readonly executorAddress: Address | null
  readonly maximumAmountIn: bigint
  readonly minimumContractProfit: bigint
  readonly minimumNetProfit: bigint
  readonly reserveFloor: bigint
  readonly cumulativeFailedGasCap: bigint
  readonly maximumFeePerGas: bigint
  readonly gasLimitMultiplierBps: bigint
  readonly l1FeeMultiplierBps: bigint
  readonly operatorFeeMultiplierBps: bigint
  readonly quoteProfitSafetyBps: bigint
  readonly validBlocks: bigint
  readonly deadlineSeconds: bigint
  readonly pollIntervalMs: number
  readonly stateDirectory: string
  readonly broadcastRpcUrls: readonly string[]
}

type Environment = Readonly<Record<string, string | undefined>>

function positiveBigint(environment: Environment, name: string, fallback: bigint): bigint {
  const raw = environment[name]
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`)
  const value = BigInt(raw)
  if (value <= 0n) throw new Error(`${name} must be positive`)
  return value
}

function boundedNumber(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${String(minimum)} and ${String(maximum)}`)
  }
  return value
}

function optionalAddress(raw: string | undefined): Address | null {
  return raw === undefined || raw === '' ? null : getAddress(raw)
}

function rpcUrls(environment: Environment): readonly string[] {
  const configured = environment.BASE_BROADCAST_RPC_URLS
  const values =
    configured === undefined || configured.trim() === ''
      ? ['https://mainnet.base.org', 'https://base-rpc.publicnode.com']
      : configured.split(',').map((value) => value.trim())
  const unique = [...new Set(values)]
  if (unique.length === 0 || unique.length > 4) {
    throw new Error('BASE_BROADCAST_RPC_URLS must contain one to four endpoints')
  }
  for (const value of unique) {
    const endpoint = new URL(value)
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      throw new Error('broadcast endpoints must use HTTP(S)')
    }
  }
  return unique
}

export function loadBaseLivePolicy(environment: Environment): BaseLivePolicy {
  const policy: BaseLivePolicy = {
    liveArm: environment.BASE_LIVE_ARM === '1',
    authorizationId:
      environment.BASE_LIVE_AUTHORIZATION_ID?.trim() === ''
        ? null
        : (environment.BASE_LIVE_AUTHORIZATION_ID?.trim() ?? null),
    executorAddress: optionalAddress(environment.BASE_EXECUTOR_ADDRESS),
    maximumAmountIn: positiveBigint(environment, 'BASE_MAX_AMOUNT_IN_WEI', 3_000_000_000_000_000n),
    minimumContractProfit: positiveBigint(
      environment,
      'BASE_MIN_CONTRACT_PROFIT_WEI',
      1_000_000_000_000n,
    ),
    minimumNetProfit: positiveBigint(environment, 'BASE_MIN_NET_PROFIT_WEI', 5_000_000_000_000n),
    reserveFloor: positiveBigint(environment, 'BASE_ETH_RESERVE_FLOOR_WEI', 5_000_000_000_000_000n),
    cumulativeFailedGasCap: positiveBigint(
      environment,
      'BASE_FAILED_GAS_CAP_WEI',
      1_000_000_000_000_000n,
    ),
    maximumFeePerGas: positiveBigint(environment, 'BASE_MAX_FEE_PER_GAS_WEI', 1_000_000_000n),
    gasLimitMultiplierBps: positiveBigint(environment, 'BASE_GAS_LIMIT_MULTIPLIER_BPS', 12_000n),
    l1FeeMultiplierBps: positiveBigint(environment, 'BASE_L1_FEE_MULTIPLIER_BPS', 15_000n),
    operatorFeeMultiplierBps: positiveBigint(
      environment,
      'BASE_OPERATOR_FEE_MULTIPLIER_BPS',
      12_000n,
    ),
    quoteProfitSafetyBps: positiveBigint(environment, 'BASE_QUOTE_PROFIT_SAFETY_BPS', 8_000n),
    validBlocks: positiveBigint(environment, 'BASE_VALID_BLOCKS', 2n),
    deadlineSeconds: positiveBigint(environment, 'BASE_DEADLINE_SECONDS', 20n),
    pollIntervalMs: boundedNumber(environment, 'BASE_POLL_INTERVAL_MS', 2_000, 250, 60_000),
    stateDirectory: environment.BASE_STATE_DIRECTORY ?? './state/base-live',
    broadcastRpcUrls: rpcUrls(environment),
  }
  if (
    policy.maximumAmountIn > 3_000_000_000_000_000n ||
    policy.reserveFloor < 5_000_000_000_000_000n ||
    policy.cumulativeFailedGasCap > 1_000_000_000_000_000n
  ) {
    throw new Error('initial canary hard bounds cannot be relaxed by environment configuration')
  }
  if (
    policy.gasLimitMultiplierBps < 10_000n ||
    policy.l1FeeMultiplierBps < 10_000n ||
    policy.operatorFeeMultiplierBps < 10_000n ||
    policy.quoteProfitSafetyBps > 10_000n
  ) {
    throw new Error('invalid safety multiplier')
  }
  if (policy.liveArm && policy.authorizationId === null) {
    throw new Error('armed live mode requires an authorization id')
  }
  return policy
}

export function amountGrid(maximumAmountIn: bigint): readonly bigint[] {
  return [12n, 6n, 3n, 2n, 1n]
    .map((divisor) => maximumAmountIn / divisor)
    .filter((amount, index, values) => amount > 0n && values.indexOf(amount) === index)
}
