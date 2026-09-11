# Atomic Cycle Engine

一个与现有实盘服务完全隔离的、证据优先的同链原子套利研究引擎。

它不以 PAIR、股票代币或某个 Meme 平台为边界。机会被统一定义为：在同一条链、同一个可证明状态上，一条 2–4 跳闭环路径在扣除池费、协议费、Gas、融资费和风险缓冲后，仍能回到原始结算资产并产生正净收益。

当前版本是 **Phase 0 / shadow-only**：

- 支持通用 2–4 跳简单环枚举；
- 支持同一状态承诺下的逐跳精确报价与金额优选；
- 支持机会全集、遗漏、拦截、尝试、胜负和未知状态的分母安全统计；
- 提供 Base 与 Robinhood Chain 的只读合约注册表核验；
- 不包含钱包、私钥、签名、广播、合约部署或生产交易权限。

## 快速开始

```bash
npm ci
npm run check
npm run registry:verify -- --network base
npm run registry:verify -- --network robinhood
```

官方公共 RPC 只用于低频注册表核验和冷读，不代表生产 SLA。Base 的 Flashblocks 端点已登记，但 pending-state 适配器尚未实现。

## 关键文档

- [技术规格](docs/TECH_SPEC.md)
- [适配器矩阵](docs/ADAPTER_MATRIX.md)
- [故事卡与验收标准](docs/STORIES.md)
- [复用台账](docs/REUSE_LEDGER.md)
- [Shadow-first ADR](docs/decisions/0001-shadow-first-dual-chain.md)
- [Sniper Engineering 规格](spec/sniper-spec.json)

## 证据语言

本项目严格区分：

- `configured`：写入配置，但尚未在线核验；
- `repository_record`：只由现有代码或文档支持；
- `live_observed`：本次只读链上/RPC 观察；
- `receipt_attested`：由规范链交易回执支持；
- `economic_reconciled`：交易回执、余额变化和所有归属成本已完成对账。

`npm run check` 通过只证明当前代码门禁通过，不证明有套利机会、正在运行、已经部署或已经盈利。
