# ADR 0006：Base 多场所实盘与资金迁移

状态：Accepted

日期：2026-09-13

## 背景

只读报价可以验证发现与成本计算，却不能验证机会是否能及时提交、是否被抢跑、实际 Gas、回执以及最终资产增量。原 Base 实盘执行器只覆盖 Uniswap V2 与 V3，无法执行已经被发现的 PancakeSwap V3 跨场所组合。

## 决策

1. 只读扫描降级为发现器，不作为成交或收益证据。Base 候选通过同状态全成本门槛后直接进入完整合约模拟、签名、同一 raw transaction 多端点广播与 Effect 对账。
2. 执行器增加三个闭集场所：Uniswap V2、Uniswap V3、PancakeSwap V3。每条路线只包含枚举场所、fee tier、allowlist token、金额、deadline 与有效区块。
3. 合约自行向官方 Factory 查询规范池，并分别实现受约束的 `uniswapV3SwapCallback` 与 `pancakeV3SwapCallback`。不开放任意 target、calldata、delegatecall 或 approve。
4. 保留既有 0.003 WETH 单笔硬上限、0.005 ETH signer 储备和失败 Gas 熔断。本 ADR 扩大场所覆盖，不扩大资本授权。
5. 新执行器先无本金部署并核验 bytecode、operator、版本、策略与 allowlist。迁移时必须停止旧 watcher、取得唯一 nonce fence、停用旧合约、把全部 WETH 原额转入新合约、核对两端余额、启用新合约，再持久化地址并恢复 watcher。
6. Robinhood/BNB 报价服务可继续提供候选，但在拥有独立 signer、资金、typed executor 与 Effect ledger 前不计作实盘能力。不得与现有 Robinhood Keeper 共用 nonce lane。

## 结果

- 可执行池组合由原来的 Uniswap V2↔V3 扩大为三个场所之间所有规范的有序两池组合，包括同一 V3 场所的不同 fee tier。
- 发现更多并不保证出现正净利；没有通过门槛时不广播，避免用真实 Gas 制造伪验证。
- 迁移包含数笔独立管理交易，无法原子完成，因此每一步均有回执与余额读回；任何未知状态停止后续动作。
