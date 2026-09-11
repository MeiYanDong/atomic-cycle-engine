# Atomic Cycle Engine

一个与现有策略服务完全隔离的、证据优先的同链原子套利引擎。

它不以 PAIR、股票代币或某个 Meme 平台为边界。机会被统一定义为：在同一条链、同一个可证明状态上，一条 2–4 跳闭环路径在扣除池费、协议费、Gas、融资费和风险缓冲后，仍能回到原始结算资产并产生正净收益。

当前包含两条边界清晰的能力线：

1. 通用 2–4 跳研究核心：Phase 0 complete / Phase 1A bounded discovery，仍为 shadow；
2. Base 实盘金丝雀：只覆盖 WETH 与 10 个明确 allowlist token 之间的规范 Uniswap V2/V3 两池闭环，已实现签名、广播、原子执行和回执对账，但是否生产激活必须以实时部署读回为准。

已经实现：

- 支持通用 2–4 跳简单环枚举；
- 支持同一状态承诺下的逐跳精确报价与金额优选；
- 支持机会全集、遗漏、拦截、尝试、胜负和未知状态的分母安全统计；
- 提供 Base 与 Robinhood Chain 的只读合约注册表核验；
- 支持 Uniswap v2/v3/v4、Aerodrome Standard/Slipstream 与 PancakeSwap v3 的类型化工厂事件解码；
- 支持小窗口、按来源隔离的池发现扫描，任何 RPC 或解码失败都显式记为 `GAPPED`；
- Base V2/V3 精确报价、金额网格、完整 calldata 模拟与 L2 Gas + L1 data fee + operator fee 成本门禁；
- 专用原子执行合约、单 nonce owner、同一 raw transaction 多 RPC 广播与规范回执/余额 Effect 对账；
- 实盘默认关闭，私钥只从 root-only 文件或 systemd credential 读取，环境变量不能放大首轮本金、储备金或失败 Gas 边界。

## 快速开始

```bash
npm ci
npm run check
npm run registry:verify -- --network base
npm run registry:verify -- --network robinhood
npm run census:window -- --network base --blocks 250 --chunk-size 250
npm run census:window -- --network robinhood --blocks 250 --chunk-size 250
npm run canary:scan -- --max-amount-wei 3000000000000000
npm run test:fork
```

官方公共 RPC 不代表生产 SLA。窗口扫描只证明指定区块范围内的发现覆盖，不证明全历史完整、存在套利机会或能够成交。`canary:scan` 的正毛利候选也不等于可成交净利润；只有签名前完整门禁和链后 `economic_reconciled` Effect 才能计为收益。Base 的 Flashblocks 端点已登记，但 pending-state 适配器尚未实现。

生产配置、部署顺序、停机与 UNKNOWN 恢复见 [实盘运行手册](docs/PRODUCTION_RUNBOOK.md)。不要把私钥、raw transaction 或带凭据的 RPC URL 写入仓库、命令行或日志。

## 关键文档

- [技术规格](docs/TECH_SPEC.md)
- [适配器矩阵](docs/ADAPTER_MATRIX.md)
- [故事卡与验收标准](docs/STORIES.md)
- [复用台账](docs/REUSE_LEDGER.md)
- [Shadow-first ADR](docs/decisions/0001-shadow-first-dual-chain.md)
- [Base 实盘金丝雀 ADR](docs/decisions/0002-base-v2-v3-live-canary.md)
- [实盘运行手册](docs/PRODUCTION_RUNBOOK.md)
- [Sniper Engineering 规格](spec/sniper-spec.json)
- [Phase 1A 真实读回](docs/evidence/2026-09-11-phase1a-bounded-census.md)

## 证据语言

本项目严格区分：

- `configured`：写入配置，但尚未在线核验；
- `repository_record`：只由现有代码或文档支持；
- `live_observed`：本次只读链上/RPC 观察；
- `receipt_attested`：由规范链交易回执支持；
- `economic_reconciled`：交易回执、余额变化和所有归属成本已完成对账。

`npm run check` 通过只证明当前代码门禁通过；`npm run test:fork` 通过只证明合约能在当时的 Base 分叉状态上走到链上利润门禁。两者都不证明主网已经部署、服务正在运行、出现了机会或已经盈利。
