# 任意多池同链原子套利：Phase 0 技术规格

状态：`APPROVED_FOR_BOUNDED_BASE_CANARY_IMPLEMENTATION`

执行模式：通用核心与 Robinhood/BNB 报价层为 `DISCOVERY_ONLY`；Base Uniswap V2/V3 + PancakeSwap V3 为 `BOUNDED_MULTI_VENUE_LIVE_CANARY`

实盘授权：`true`，仅限 ADR 0002 的地址、链、路线、资产 allowlist 和硬风险边界；当前是否激活以生产读回为准

## 1. 第一性原理

套利的本质不是“某个平台标错价”，也不是“股票币或 Meme 币涨了”。本质是同一时点存在两条以上可执行的价值转换路径，而一条闭环在付清全部成本后能得到更多的原始资产。

对结算资产 `A`、输入量 `x` 和路径 `r`：

```text
Gross(r, x, s) = ExactOut(r, x, state=s) - x
Net(r, x, s)   = Gross - GasInA - FinancingFeeInA - KnownProtocolCostsInA - RiskBufferInA
```

只有同时满足以下条件，才叫“可执行机会”：

1. 每一跳在同一 `state_reference + state_commitment` 下报价；
2. 路径在一笔交易里从 `A` 出发并回到 `A`；
3. 不重复使用同一份可变流动性；
4. `Net > approved_min_profit`，且最优输入量不超过实际深度、余额和授权；
5. calldata 在链上强制最终余额增量下限；
6. 成功后没有未知残余仓位；失败最多损失已批准的 Gas；
7. 同一机会没有被更晚状态替换，也没有过期。

因此，NINECAT/AI 一类“计价资产上涨、代币页面价格陈旧”的现象只是候选信号。若不存在独立退出池，或成交深度不足，它不是套利。

## 2. 路径空间

Phase 0 只研究同链现货池闭环：

```text
2 跳：A → B（池 1）→ A（池 2）
3 跳：A → B → C → A
4 跳：A → B → C → D → A
```

结算资产可以是 WETH、USDC、USDG 或其他明确允许的资产；配对资产可以是股票代币、Meme、AI、稳定币或普通 ERC-20。资产类别不参与套利成立条件。

当前明确排除：

- CEX/DEX 闭环：无法在同一链上交易中原子结算；
- 跨链闭环：桥接和最终性带来库存与时间风险；
- 清算、抢购和发币首块：奖励规则与多池价差不同，应建立独立策略规格；
- 未审计 Hook、转账税币、rebase/ERC-777 类资产的实盘执行；它们可被发现，但默认拦截。

## 3. 来源与身份模型

每条事实保留四个互不推导的维度：

| 维度             | 回答的问题       | 例子                                     |
| ---------------- | ---------------- | ---------------------------------------- |
| discovery source | 在哪里发现       | 链上 Factory 日志、PAIR API、DexScreener |
| launch platform  | 从哪里发行/进入  | LONG_ROUTE、PAIR、UNKNOWN                |
| launch protocol  | 使用什么发行协议 | Doppler、UNKNOWN                         |
| liquidity venue  | 在哪里成交       | Uniswap v3/v4、Aerodrome                 |

PAIR 只是 Robinhood Chain 上的一个候选发现/平台来源。NINECAT 的已核验归因是 `LONG_ROUTE / DOPPLER / UNISWAP_V4`；任何适配器都不得因“某 API 返回了它”而把平台改写成 PAIR。

## 4. 系统边界

```text
链上 Factory/PoolManager 日志 ─┐
平台/API/索引器补充来源 ────────┼─> 规范化 PoolFact + 独立来源证据
官方协议注册表 ────────────────┘
                                      ↓
                         本地 token-pool 有向图
                                      ↓
                        2–4 跳简单闭环枚举
                                      ↓
             状态缓存 → 同状态逐跳 quote → 输入量搜索
                                      ↓
        成本模型 → 净收益门槛 → OpportunityRecord
                                      ↓
        Base typed plan → 模拟 → 签名 → 广播 → Effect 对账
                                      ↓
         机会全集/遗漏/拦截/竞速/UNKNOWN 复盘
```

热路径只允许读取已归一化的本地状态和不可变计划。目录发现、ABI 拉取、代币元数据、历史回填、外部价格展示、通知和经营面板全部在冷路径。

## 5. 适配器契约

一个协议只有逐级满足下列契约，才会进入下一层：

1. `DiscoveryAdapter`：从官方 Factory/PoolManager 事件产出不可变 `PoolFact`，有块高、块哈希、日志索引和回滚规则；
2. `StateAdapter`：把池状态映射为带 `state_reference` 的本地快照；
3. `QuoteAdapter`：对任意精确输入量返回 exact-output、Gas 估计、证据级别和完全相同的状态承诺；
4. `RiskAdapter`：识别 Hook、转账税、暂停、黑名单、代理升级和非标准 ERC-20 语义；
5. `CalldataAdapter`：把路线、金额、状态边界和链上利润下限绑定为一个不可变计划；目前在 Base Uniswap V2/V3/PancakeSwap V3 金丝雀实现；
6. `EffectAdapter`：用规范链回执、执行事件、WETH 余额变化和完整 Gas 归属给出 `RECONCILED_SUCCESS / RECONCILED_REVERT / UNKNOWN / DISPUTED`；目前在同一金丝雀实现。

发现范围可以很宽，但任何没有 typed adapter、同状态 exact quote 和风险语义的协议都只能停留在观察层。

## 6. 链与协议优先级

### Base

优先级 P0：Uniswap v2/v3 与 PancakeSwap v3 已进入有界实盘。执行合约只接受三个枚举场所、规范 Factory 返回的池、明确 fee tier 和 allowlist token；同时实现 Uniswap/Pancake 两种受约束回调，不接受任意 target/calldata。候选通过同状态全成本门槛后直接实盘，不以 shadow 作为收益验证。

下一批：Uniswap v4、Aerodrome Standard/Slipstream。Aerodrome 的 CLFactory 不能写死一个地址，必须从其 FactoryRegistry 动态校验当前批准集合。Base Flashblocks 在完成 gap/reorg/sequence 语义验证前仅能加速发现，不能替代规范回执。

### Robinhood Chain

在现有 Uniswap v3/v4 观察面之外增加官方 Uniswap v2 与 PancakeSwap v2/v3 独立场所。Long 与 PAIR 仅作为来源维度。现有固定 `USDG/WETH → PAIR target → USDG/WETH` 执行形状不迁移为通用执行器，新场所不继承其签名授权。

### BNB Chain

P0 只读范围为 PancakeSwap v2/v3 与 Uniswap v2/v3/v4。官方公共 RPC 只用于有界代码、区块和 `eth_call` 探测；由于公共端点不提供 `eth_getLogs`，任何持续日志普查必须显式使用独立 provider 能力并记录请求成本。BNB 的 PBS/Builder 竞争属于执行经济学；在没有 builder 路由、同状态全成本正样本和单独授权前，全部能力保持 shadow。

### 跨场所影子报价切片

第一批持续切片只比较两链上已核验地址的 Uniswap/PancakeSwap V2/V3 两跳闭环。V2 经协议 Router 获取 exact-output，V3 先读取 Factory 的 fee-tier 池身份，再调用该 venue 的 QuoterV2。整轮绑定同一块高与块哈希，结束后再次核对规范哈希；重组、链身份错误或顶层 RPC 失败整链 fail closed。报价失败与不存在的路线分开计数。

只读连续切片可对“transport 抛错”额外重试一次并等待 200ms；JSON-RPC/EVM 错误不重试，避免把确定性业务失败变成请求风暴。公开成本证据分别保留逻辑报价、逻辑 RPC、实际 provider request、transport 失败、成功恢复的逻辑请求和最终未解决报价失败。恢复后的完整同块扫描可以保持 `CURRENT`，但失败过的 provider 尝试仍计入成本。

影子净收益为 `闭环输出 - 输入 - gasPrice × 600,000 - 10 bps 风险储备`。每个资产先跑最小金额，只有该金额存在毛利为正路线才扩大第二金额；对当前标准 AMM 两跳切片，负的小额闭环不会因增加冲击而改善。该规则降低公共 RPC 消耗，但仍不外推到稳定曲线、Hook 或任意 3–4 跳。这是保守筛选，不是执行 Gas 的精确证明，也不是交易授权。公开文件只含链、场所、资产、金额档、漏斗、最佳路线和状态承诺，不含 RPC URL、钱包或任何签名材料。

## 7. 金额优化

不能把“25U 上限”或“100U 一次”写死。对每条路径，在离散候选输入上先粗搜，再围绕最好区间细搜；目标函数是成本后的 `Net`，不是价差百分比。上限由以下最小值决定：

```text
min(用户批准本金, 钱包可用余额, 路径安全容量, 风险适配器上限, 协议/融资上限)
```

Gas 是近似固定成本时，极小金额常被 Gas 吞没；金额过大又被滑点吞没。最优解只能由当时的完整曲线得出。

## 8. RPC 分层与成本

- 冷读：官方公共 HTTP RPC，负责注册表、历史回填、低频元数据和健康检查；
- Base 热观察：Flashblocks pending endpoint，只在适配器验证后启用；
- 付费 RPC：只有影子数据证明机会损失主要来自公共 RPC 的延迟/限流，且增量预期收益大于增量成本时，才按能力和链分配；
- 任何一次 RPC 成功只证明该请求成功，不证明生产 SLA；429、缺块、重组和不一致必须进入证据账本。

ChainStack 不再承担全量冷扫描。它的用量扩容需要明确的边际收益证据，不因“池子更多”自动升级。

## 9. 机会全集与竞速真相

系统必须同时记录：

```text
CHAINWIDE
├─ NOT_OBSERVED
└─ OBSERVED
   ├─ OBSERVED_AFTER_EXPIRY
   ├─ NO_SHOT_NEGATIVE_EV / NO_SHOT_POLICY
   ├─ BLOCKED_CORRECTNESS / BLOCKED_RESOURCE
   ├─ LOW_VALUE_GUARD_EXIT / INVALID_OPPORTUNITY_EXIT
   └─ ATTEMPTED → WON / CONFIRMED_LOST_RACE / UNKNOWN
```

`UNKNOWN` 不得算失败；低价值主动退出不得算竞速失败；只有同一机会身份、同一状态窗口下的 `WON + CONFIRMED_LOST_RACE` 才构成胜率分母。

## 10. 晋级门槛

下列数值是本次批准的工程门槛，不是收益承诺；不满足时继续影子运行，不降低门槛：

### Phase 0 → Phase 1（在线普查）

- `npm run check` 全部通过；
- Sniper Engineering v1.4 外部校验为 `VALID`；
- 三条链的注册表核验无 `NO_CODE/UNKNOWN`，否则对应协议隔离；
- 代码和产物秘密扫描为零发现；
- 写入证据的每条机会都带链、状态、路线、金额和来源承诺。

### Phase 1 → Phase 2（全量 Shadow）

- 每个晋级适配器覆盖区间 100% 可解释：无未回填 gap，重组已修正；
- 连续 7 个完整 UTC 日或累计 10,000 个相关状态变化，取更晚者；
- 全部候选都有唯一终态，未解决 `UNKNOWN` 单独列示；
- 至少 100 个正毛差候选完成同状态全成本反事实；若不足，只能说明市场样本不足，不能推断可盈利；
- quote-to-state 延迟分布、机会半衰期、公共 RPC 失败率和竞争结果都有可复算原始证据。

### Phase 2 → 通用自有资金 Canary

- 至少 30 个相互独立、扣除全部已知成本后仍为正的反事实机会；
- 路线级 `p25 opportunity_lifetime` 大于端到端 `p95 decision_to_submit`；
- 在压力 Gas、滑点和融资费情景下，保守 `p05 net_profit` 仍大于零；
- 模拟/历史精确重放的资产守恒、链上利润下限和无残余仓位测试 100% 通过；
- 执行合约、Signer、nonce、广播、reconcile 和 kill-switch 经过独立审计；
- 用户另行明确批准钱包、单笔本金、累计 Gas 损失与生产部署。

Canary 金额取“用户批准上限、影子样本安全容量 p10、可用余额”的最小值。实盘交易次数未来可以不设次数上限，但利润下限、Gas 日损失、UNKNOWN 隔离、余额和敞口熔断永不取消。

ADR 0002 记录了一个明确例外：用户接受跳过完整通用 Phase 2 样本，先对 Base Uniswap V2/V3 的窄路线做 `0.01 ETH` 资金金丝雀。该例外不使其他协议、路线或更大本金自动晋级。

## 11. Phase 0 交付边界

Phase 0 的历史交付为类型化核心、单元测试、CI、注册表核验 CLI、规格、ADR、故事卡和复用台账。之后新增的 Base 金丝雀不是通用执行器：它只允许 WETH 起止、规范 Uniswap V2/V3 工厂和明确资产 allowlist。

## 12. Base V2/V3 实盘金丝雀

### 12.1 路线与资产

```text
WETH → token（Uniswap V2）→ WETH（Uniswap V3）
WETH → token（Uniswap V3）→ WETH（Uniswap V2）
```

首轮 token allowlist 为 USDC、USDbC、cbETH、DAI、cbBTC、AERO、DEGEN、TOSHI、VIRTUAL、AIXBT。允许列表只决定可承担本金的资产，不代表每个资产此刻都有池、深度或正利润。

### 12.2 不可放大的风险边界

- 单笔 `amountIn <= 0.003 WETH`；
- Signer 交易后保留 `>= 0.005 ETH`；
- 累计规范回执确认的失败 Gas 达 `0.001 ETH`，停止新增交易；
- 每笔保守报价毛利必须覆盖最大 L2 Gas、放大后的 Base L1 data fee、operator fee，并在这些成本后至少保留 `1 wei` 正净利润；真正的经济门槛由费用放大和报价安全折扣决定，不再叠加固定收益额度；
- 全市场发现后的候选不得直接沿用旧快照签名；只有先达到静态利润底线、再按最新规范区块对同一路线和金额定向重报价，才进入 Gas 估算与完整执行器模拟；
- quote 利润按 80% 安全折扣，Gas limit 按 120%、L1 fee 按 150%、operator fee 按 120% 计算；
- 机会最多有效 2 个 Base 区块且 deadline 20 秒；
- 这些首轮本金/储备/累计失败 Gas 上限不能由环境变量放宽。

### 12.3 结算真相

签名前的 `eth_call` 只证明该状态下模拟成功。广播后必须核对：规范块哈希、receipt status、执行合约发出的路线事件、实际 WETH 增量、L2 Gas、receipt 的 Base `l1Fee`，以及回执块状态下 GasPriceOracle 的 operator fee。只有 `grossProfit - L2Gas - l1Fee - operatorFee >= minimumNetProfit` 才写入 `RECONCILED_SUCCESS`；缺失或矛盾进入 `DISPUTED` 并冻结该 nonce lane。
