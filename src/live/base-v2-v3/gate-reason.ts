const SAFE_GATE_MESSAGES = new Map<string, string>([
  ['candidate is not a positive exact quote', '候选不是精确毛利为正报价'],
  ['positive gross quote is below the contract profit floor', '毛利低于合约利润底线'],
  [
    'positive gross quote cannot clear the net profit floor before gas',
    '毛利在计算 Gas 前已低于净利润底线',
  ],
  ['candidate exceeds principal cap', '候选超过单笔本金边界'],
  ['live execution policy is not armed', '实盘策略未武装'],
  ['executor has no deployed code', '执行合约没有链上代码'],
  ['executor version is not approved', '执行合约版本不匹配'],
  ['signer is not the executor operator', '签名钱包不是合约操作员'],
  ['executor is disarmed', '执行合约未启用'],
  ['candidate token is not approved on the executor', '候选代币未获合约批准'],
  ['on-chain and runtime principal caps differ', '链上与运行时本金边界不一致'],
  ['on-chain and runtime contract profit floors differ', '链上与运行时利润底线不一致'],
  ['executor principal is insufficient', '执行合约本金不足'],
  ['quote block commitment mismatch', '报价区块承诺不一致'],
  ['current Base max fee exceeds the live policy cap', '当前 Base Gas 超过策略上限'],
  [
    'positive gross quote does not clear gas, net profit, and quote safety gates',
    '毛利无法覆盖 Gas、净利润底线和安全折扣',
  ],
  ['signer ETH would fall below the reserve floor', 'Gas 钱包会跌破储备底线'],
  ['full executor simulation missed profit floor', '完整合约模拟未达到利润底线'],
  ['candidate disappeared during latest-block re-quote', '最新区块重报价后毛利消失'],
  ['canonical route changed during re-quote', '重报价时规范池身份发生变化'],
  ['canonical route has no active liquidity', '重报价时规范池已无有效流动性'],
])

const SAFE_CONTRACT_ERRORS = new Map<string, string>([
  ['ProfitTooLow', '链上模拟利润低于执行门槛'],
  ['Expired', '交易执行期限已过'],
  ['StaleBlock', '交易有效区块已过'],
  ['NotOperator', '调用钱包不是合约操作员'],
  ['NotArmed', '执行合约未启用'],
  ['Reentered', '执行合约检测到重入'],
  ['InvalidRoute', '执行路线参数无效'],
  ['InvalidAmount', '执行金额无效'],
  ['ProfitFloorTooLow', '提交的利润底线低于合约底线'],
  ['TokenNotApproved', '候选代币未获合约批准'],
  ['InsufficientPrincipal', '执行合约本金不足'],
  ['MissingCanonicalPool', '规范池不存在'],
  ['InvalidPoolIdentity', '池身份校验失败'],
  ['InvalidSwapDelta', '交换余额变化校验失败'],
  ['NonStandardTokenBehavior', '代币行为不满足原子执行约束'],
  ['UnauthorizedCallback', '池回调身份校验失败'],
  ['ResidualExposure', '原子循环留下中间代币敞口'],
  ['TokenCallFailed', '代币转账调用失败'],
])

const SAFE_PUBLIC_REASONS = new Set([
  ...SAFE_GATE_MESSAGES.values(),
  ...SAFE_CONTRACT_ERRORS.values(),
  '未知执行校验错误',
])

export function isSafePublicGateReason(value: unknown): value is string {
  return typeof value === 'string' && SAFE_PUBLIC_REASONS.has(value)
}

export function safeGateReason(error: unknown): string {
  const pending: unknown[] = [error]
  const visited = new Set<object>()
  while (pending.length > 0 && visited.size < 64) {
    const value = pending.shift()
    if (typeof value === 'string') {
      const safeMessage = SAFE_GATE_MESSAGES.get(value)
      if (safeMessage !== undefined) return safeMessage
      for (const [name, label] of SAFE_CONTRACT_ERRORS) {
        if (value.includes(name)) return label
      }
      continue
    }
    if (typeof value !== 'object' || value === null || visited.has(value)) continue
    visited.add(value)
    if (value instanceof Error) {
      pending.push(value.message, value.name)
      if ('cause' in value) pending.push(value.cause)
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'errorName' && typeof child === 'string') {
        const label = SAFE_CONTRACT_ERRORS.get(child)
        if (label !== undefined) return label
      }
      pending.push(child)
    }
  }
  return '未知执行校验错误'
}
