# 2026-09-11 Phase 1A 有界池发现读回

证据时间：2026-09-11 16:53–16:57（UTC+8）

范围：官方/登记公共 RPC 的只读合约核验，以及两个主网各最近 250 个区块的 Factory/PoolManager 事件扫描。

不证明：全历史池全集、当前流动性、同状态可执行报价、套利机会频率、生产运行、交易或盈利。

本地 `reports/*.json` 是被 `.gitignore` 排除的 0600 原始读回；本文件只固化审查所需摘要，避免把漂移快照伪装成代码事实。

## Base 注册表

命令：

```bash
npm run registry:verify -- --network base \
  --output reports/base-registry-2026-09-11.json
```

读回：

- endpoint origin：`https://mainnet.base.org/`；
- chain ID：8453；
- observed block：`51,163,816`；bounded requests：20；
- 17/17 登记地址在同一明确观察块返回非空 bytecode；
- `NO_CODE=0`，`UNKNOWN=0`；
- Aerodrome FactoryRegistry 返回 4 个批准工厂，均在配置内且无过期配置：
  - Standard：`0x420DD381b31aEf6683db6B902084cB0FFECe40Da`；
  - Slipstream v1：`0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A`；
  - Slipstream v2：`0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a`；
  - Slipstream v3：`0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`。

`eth_getCode` 只证明观察块存在代码。动态 registry 匹配只证明批准工厂集合与本次配置一致；两者都不证明池可报价或可执行。

## Base 最近 250 区块窗口

命令：

```bash
npm run census:window -- --network base --blocks 250 --chunk-size 250 \
  --output reports/base-census-window-2026-09-11.json
```

读回块范围：`51,163,469–51,163,718`。

| 来源                          | Pool facts | Coverage          |
| ----------------------------- | ---------: | ----------------- |
| Uniswap v2 Factory            |          5 | COMPLETE，0 gap   |
| Uniswap v3 Factory            |          0 | COMPLETE，0 gap   |
| Uniswap v4 PoolManager        |         20 | COMPLETE，0 gap   |
| Aerodrome Standard Factory    |          0 | COMPLETE，0 gap   |
| Aerodrome Slipstream v1/v2/v3 |          0 | COMPLETE，0 gap   |
| PancakeSwap v3 Factory        |          0 | COMPLETE，0 gap   |
| 合计                          |         25 | 8/8 来源 COMPLETE |

这说明该窗口内 Base 有活跃的新池创建，且 v4 占多数。v4 的动态费率与 Hook 必须先经过风险适配器，不能因为“发现了 20 个池”就进入报价或执行。

## Robinhood Chain 注册表与最近 250 区块窗口

命令：

```bash
npm run registry:verify -- --network robinhood \
  --output reports/robinhood-registry-2026-09-11.json
npm run census:window -- --network robinhood --blocks 250 --chunk-size 250 \
  --output reports/robinhood-census-window-2026-09-11.json
```

读回：

- endpoint origin：`https://rpc.mainnet.chain.robinhood.com/`；
- chain ID：4663；
- observed block：`60,130,887`；bounded requests：9；
- 7/7 登记地址返回非空 bytecode，`NO_CODE=0`，`UNKNOWN=0`；
- 窗口块范围：`60,129,960–60,130,209`；
- Uniswap v3 Factory 与 v4 PoolManager 均为 `COMPLETE`、0 gap；
- 新 pool facts：0。

零事实只表示这个短窗口没有观察到新建池，不表示没有存量池，也不表示长期机会为零。

## 当前结论

1. PAIR/Robinhood Chain 不再是架构边界；同口径短窗口里 Base 的池创建供给显著更活跃。
2. “发现池”与“发现可执行套利”之间仍缺 state、exact quote、risk、成本和竞争五层证据。
3. 下一步必须做持久游标、gap-free 分段回填和重组撤销，再做状态缓存与 P0 exact quote；现在购买 RPC 或接入钱包没有证据基础。
