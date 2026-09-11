# 适配器与信息源矩阵

状态含义：`implemented` 仅指本仓库已有代码；`planned` 是下一阶段；`discovery-only` 不得进入执行计划；`registry-only` 只核验身份。

## 链上执行候选

| 链        | 协议/场所            | Discovery          | State                         | Exact quote                         | Calldata | 当前状态                     | 优先级 |
| --------- | -------------------- | ------------------ | ----------------------------- | ----------------------------------- | -------- | ---------------------------- | ------ |
| Base      | Uniswap v2           | Factory events     | reserves                      | x*y=k 本地数学                      | 无       | 数学核已实现，链适配 planned | P0     |
| Base      | Uniswap v3           | Factory events     | slot0/ticks/liquidity         | QuoterV2 + 本地状态                 | 无       | registry-only / planned      | P0     |
| Base      | Uniswap v4           | PoolManager events | StateView + Hook identity     | Quoter + Hook policy                | 无       | registry-only / planned      | P0     |
| Base      | Aerodrome Standard   | PoolFactory events | reserves/stable flag          | typed pool quote                    | 无       | registry-only / planned      | P0     |
| Base      | Aerodrome Slipstream | Factory events     | concentrated state            | official Quoter                     | 无       | registry-only / planned      | P0     |
| Base      | PancakeSwap v3       | Factory events     | slot0/ticks/liquidity         | Base-specific Quoter                | 无       | factory registry-only        | P1     |
| Robinhood | Uniswap v3           | Factory events     | slot0/ticks/liquidity         | existing quoter mechanism migration | 无       | repository record / planned  | P0     |
| Robinhood | Uniswap v4           | PoolManager events | manager state + Hook identity | existing quote mechanism migration  | 无       | repository record / planned  | P0     |

## 候选发现来源

| 来源                          | 能提供什么                     | 不能证明什么                         | 使用方式                          |
| ----------------------------- | ------------------------------ | ------------------------------------ | --------------------------------- |
| 链上 Factory/PoolManager 日志 | 池身份、资产、费率、创建块     | 当前可盈利                           | 规范普查源，最高优先级            |
| PAIR 平台/API                 | PAIR 平台资产线索与展示数据    | 其他平台归因、真实 venue、可执行报价 | Robinhood 补充 discovery-only     |
| Long/Doppler 入口与事件       | 发行平台/协议归因              | 所有后续流动性归属                   | 独立 provenance 维度              |
| DexScreener / GeckoTerminal   | 快速候选、交易活跃度           | 全集、同状态报价、链上结算           | 冷路径补充，不作为 truth source   |
| 聚合器 API                    | 可能路径与可达性               | 原子利润、稳定可复现路由             | 研究/交叉验证，不直接生成执行计划 |
| Base Flashblocks              | pending 状态与日志、低延迟序列 | 最终包含、无重组、Robinhood 可用性   | Base 影子信号，sequence 单独记账  |

## 适配器晋级规则

每个协议按 `registry-only → discovery → state → quote → risk → calldata → effect` 顺序晋级。任一级无法证明语义时，只隔离该协议/Hook，不停止其他已验证能力。任何网页或聚合器返回的新池不会自动获得执行权限。
