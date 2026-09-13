# Atomic Cycle Engine

一个与现有策略服务完全隔离的、证据优先的同链原子套利引擎。

它不以 PAIR、股票代币或某个 Meme 平台为边界。机会被统一定义为：在同一条链、同一个可证明状态上，一条 2–4 跳闭环路径在扣除池费、协议费、Gas、融资费和风险缓冲后，仍能回到原始结算资产并产生正净收益。

当前包含三条边界清晰的能力线：

1. 通用 2–4 跳研究核心：Phase 0 complete / Phase 1A bounded discovery，仍为 shadow；
2. Base 多场所实盘金丝雀：覆盖 WETH 与 10 个明确 allowlist token 之间的 Uniswap V2、Uniswap V3、PancakeSwap V3 两池闭环，已实现签名、广播、原子执行和回执对账；当前生产版本仍须以实时读回为准；
3. Robinhood P0：36 条 DEX 两跳路线之外，加入 4 条 Earn 多池路线与 40 条 Earn↔DEX 混合路线；四条纯 Earn 路线已有独立类型化 keeper，其余路线仍不继承签名权限；
4. BNB P1：覆盖 6 个流动资产、72 条两跳 DEX 路线和 8 条逐跳择优的三角资产路径；Builder/PBS 与类型化执行器完成前不充值、不部署、不广播。

已经实现：

- 支持通用 2–4 跳简单环枚举；
- 支持同一状态承诺下的逐跳精确报价与金额优选；
- 支持机会全集、遗漏、拦截、尝试、胜负和未知状态的分母安全统计；
- 提供 Base 与 Robinhood Chain 的只读合约注册表核验；
- 支持 Uniswap v2/v3/v4、Aerodrome Standard/Slipstream 与 PancakeSwap v3 的类型化工厂事件解码；
- 支持小窗口、按来源隔离的池发现扫描，任何 RPC 或解码失败都显式记为 `GAPPED`；
- 支持 Robinhood 的 Earn/Balancer V3 池级精确报价、Earn↔DEX 混合闭环，以及 BNB 的 CAKE/ETH/BTCB 与 3 跳三角路径；所有结果在固定区块扣除保守 Gas 与风险储备后发布；
- 金额采用五档几何阶梯逐档放大，当前档位无毛利即停止；这些只是观察范围，不是实盘资金上限；
- Base 三场所精确报价、金额网格、完整 calldata 模拟与 L2 Gas + L1 data fee + operator fee 成本门禁；
- 专用原子执行合约、单 nonce owner、同一 raw transaction 多 RPC 广播与规范回执/余额 Effect 对账；
- 实盘默认关闭，私钥只从 root-only 文件或 systemd credential 读取，环境变量不能放大首轮本金、储备金或失败 Gas 边界。

## 快速开始

```bash
npm ci
npm run check
npm run registry:verify -- --network base
npm run registry:verify -- --network robinhood
npm run registry:verify -- --network bnb
npm run census:window -- --network base --blocks 250 --chunk-size 250
npm run census:window -- --network robinhood --blocks 250 --chunk-size 250
npm run census:window -- --network bnb --blocks 100 --chunk-size 100
npm run shadow:cross-venue -- --once --network all --output /tmp/atomic-cycle-shadow.json
npm run canary:scan -- --max-amount-wei 3000000000000000
npm run test:fork
```

官方公共 RPC 不代表生产 SLA。窗口扫描只证明指定区块范围内的发现覆盖，不证明全历史完整、存在套利机会或能够成交。`canary:scan` 的正毛利候选也不等于可成交净利润；实盘 watcher 会让所有正毛利候选进入最新规范区块定向重报价，再执行完整 Gas、余额、模拟和广播门禁。执行合约毛利底线和额外净利底线都只有 1 wei，真正的动态门槛由 L2 Gas、L1 data fee、operator fee、保守倍率和报价折扣共同决定。只有链后 `economic_reconciled` Effect 才能计为收益。Base 的 Flashblocks 端点已登记，但 pending-state 适配器尚未实现。

`shadow:cross-venue` 是 Robinhood/BNB 的候选发现器，不被当成交易验证或收益证据。它会清楚标明纯 Earn 已有独立执行路径，或混合/BNB 路线仍缺类型化执行器；任何毛利为正但 Gas 后为负的路线都不会签名。Base 候选一旦通过同状态全成本门槛，才会进入完整合约模拟、签名、广播和 Effect 对账。

生产配置、部署顺序、停机与 UNKNOWN 恢复见 [实盘运行手册](docs/PRODUCTION_RUNBOOK.md)。不要把私钥、raw transaction 或带凭据的 RPC URL 写入仓库、命令行或日志。

## 关键文档

- [技术规格](docs/TECH_SPEC.md)
- [适配器矩阵](docs/ADAPTER_MATRIX.md)
- [故事卡与验收标准](docs/STORIES.md)
- [复用台账](docs/REUSE_LEDGER.md)
- [Shadow-first ADR](docs/decisions/0001-shadow-first-dual-chain.md)
- [Base 实盘金丝雀 ADR](docs/decisions/0002-base-v2-v3-live-canary.md)
- [三链独立场所 Shadow ADR](docs/decisions/0003-three-chain-independent-venue-shadow.md)
- [公共 RPC 有界重试与真实请求计数 ADR](docs/decisions/0004-bounded-public-rpc-retry.md)
- [Base nonce fence 重启与 PID 复用 ADR](docs/decisions/0005-reboot-safe-live-fence.md)
- [Base 多场所实盘与资金迁移 ADR](docs/decisions/0006-base-multivenue-live.md)
- [Gas-only 正收益门槛 ADR](docs/decisions/0007-gas-only-positive-net-floor.md)
- [Robinhood Earn/DEX 与 BNB 流动路线簿 ADR](docs/decisions/0008-robinhood-earn-and-bnb-liquid-route-book.md)
- [实盘运行手册](docs/PRODUCTION_RUNBOOK.md)
- [Sniper Engineering 规格](spec/sniper-spec.json)
- [Phase 1A 真实读回](docs/evidence/2026-09-11-phase1a-bounded-census.md)
- [Base 实盘激活证据](docs/evidence/2026-09-11-base-live-activation.md)
- [Base 固定利润门槛移除与实盘证据](docs/evidence/2026-09-13-base-gas-only-live-production.md)

## 证据语言

本项目严格区分：

- `configured`：写入配置，但尚未在线核验；
- `repository_record`：只由现有代码或文档支持；
- `live_observed`：本次只读链上/RPC 观察；
- `receipt_attested`：由规范链交易回执支持；
- `economic_reconciled`：交易回执、余额变化和所有归属成本已完成对账。

`npm run check` 通过只证明当前代码门禁通过；`npm run test:fork` 通过只证明合约能在当时的 Base 分叉状态上走到链上利润门禁。两者都不证明主网已经部署、服务正在运行、出现了机会或已经盈利。
