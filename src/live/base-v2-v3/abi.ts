import { parseAbi } from 'viem'

export const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

export const WETH_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function deposit() payable',
  'function transfer(address to, uint256 amount) returns (bool)',
])

export const UNISWAP_V2_FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
])

export const UNISWAP_V2_PAIR_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
])

export const UNISWAP_V3_FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
])

export const UNISWAP_V3_POOL_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
])

// Pancake V3 uses uint32 for feeProtocol. Decoding it with the Uniswap uint8
// shape can reject otherwise valid pool state.
export const PANCAKESWAP_V3_POOL_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)',
])

export const UNISWAP_V3_QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export const BASE_EXECUTOR_ABI = [
  { type: 'error', name: 'NotOperator', inputs: [] },
  { type: 'error', name: 'WrongChain', inputs: [] },
  { type: 'error', name: 'NotArmed', inputs: [] },
  { type: 'error', name: 'MustDisarm', inputs: [] },
  { type: 'error', name: 'Reentered', inputs: [] },
  { type: 'error', name: 'Expired', inputs: [] },
  { type: 'error', name: 'StaleBlock', inputs: [] },
  { type: 'error', name: 'InvalidConfiguration', inputs: [] },
  { type: 'error', name: 'InvalidRoute', inputs: [] },
  { type: 'error', name: 'TokenNotApproved', inputs: [] },
  { type: 'error', name: 'DuplicateToken', inputs: [] },
  { type: 'error', name: 'TooManyTokens', inputs: [] },
  { type: 'error', name: 'InvalidAmount', inputs: [] },
  { type: 'error', name: 'ProfitFloorTooLow', inputs: [] },
  { type: 'error', name: 'InsufficientPrincipal', inputs: [] },
  { type: 'error', name: 'MissingCanonicalPool', inputs: [] },
  { type: 'error', name: 'InvalidPoolIdentity', inputs: [] },
  { type: 'error', name: 'InvalidSwapDelta', inputs: [] },
  { type: 'error', name: 'NonStandardTokenBehavior', inputs: [] },
  { type: 'error', name: 'UnauthorizedCallback', inputs: [] },
  {
    type: 'error',
    name: 'ResidualExposure',
    inputs: [
      { name: 'beforeBalance', type: 'uint256' },
      { name: 'afterBalance', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ProfitTooLow',
    inputs: [
      { name: 'actual', type: 'uint256' },
      { name: 'required', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'TokenCallFailed', inputs: [] },
  {
    type: 'event',
    name: 'Executed',
    anonymous: false,
    inputs: [
      { name: 'routeHash', type: 'bytes32', indexed: true },
      { name: 'intermediateToken', type: 'address', indexed: true },
      { name: 'entryPool', type: 'address', indexed: true },
      { name: 'exitPool', type: 'address', indexed: false },
      { name: 'entryVenue', type: 'uint8', indexed: false },
      { name: 'exitVenue', type: 'uint8', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
      { name: 'grossProfit', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'EXECUTOR_VERSION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'constructor',
    stateMutability: 'payable',
    inputs: [
      { name: 'operator_', type: 'address' },
      { name: 'maximumAmountIn_', type: 'uint256' },
      { name: 'minimumGrossProfit_', type: 'uint256' },
      { name: 'initialApprovedTokens', type: 'address[]' },
    ],
  },
  {
    type: 'function',
    name: 'armed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'approvedToken',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: 'approved', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'maximumAmountIn',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'minimumGrossProfit',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'operator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setArmed',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nextArmed', type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setTokenApproval',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'route',
        type: 'tuple',
        components: [
          { name: 'intermediateToken', type: 'address' },
          { name: 'entryFee', type: 'uint24' },
          { name: 'exitFee', type: 'uint24' },
          { name: 'entryVenue', type: 'uint8' },
          { name: 'exitVenue', type: 'uint8' },
        ],
      },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minProfit', type: 'uint256' },
      { name: 'deadline', type: 'uint48' },
      { name: 'validThroughBlock', type: 'uint64' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'grossProfit', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  },
] as const

export const LEGACY_BASE_EXECUTOR_ADMIN_ABI = [
  {
    type: 'function',
    name: 'armed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'operator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setArmed',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nextArmed', type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  },
] as const

export const GAS_PRICE_ORACLE_ABI = parseAbi([
  'function getL1Fee(bytes data) view returns (uint256)',
  'function getL1GasUsed(bytes data) view returns (uint256)',
  'function getOperatorFee(uint256 gasUsed) view returns (uint256)',
])
