# Changelog

## Unreleased

- Deploy the Robinhood-first and BNB-second route book from merge commit `8b67df7` to the shared production host while
  preserving the existing Robinhood and Base live executors. Record two current fixed-block cycles, no gas-adjusted
  positive route and no new broadcast; expanded routes remain quote-only until a typed atomic executor exists.
- Recover the Robinhood live watcher from inode exhaustion after verifying its arm, locks and empty unresolved ledger;
  remove only nine unreferenced, GitHub-rebuildable releases and add disk/inode, POSIX shell, dependency-mask and stale
  nonce-fence gates to the production runbook.
- Prioritize Robinhood and BNB discovery without changing live authority: add fixed-block EarnOnHood/Balancer V3 pool
  quotes, four reviewed Earn cycles, 40 single-leg Earn/DEX substitutions, three additional liquid BNB assets and eight
  best-of-venue three-hop BNB paths. A progressive geometric amount ladder stops after the first gross-negative tier
  without imposing a live capital cap. Public output now distinguishes route type and typed-execution readiness.

- Bind the Base live nonce-owner fence to the Linux boot ID and process start ticks, retain a guarded legacy migration,
  and verify the owner token before release so a reboot-time PID reuse cannot strand or steal the nonce lane.
- Add one bounded retry for thrown read-only transport failures in the Robinhood/BNB shadow while never retrying a
  JSON-RPC contract error. Publish actual provider attempts, transient failures, recovered reads and unresolved quote
  failures separately so public-RPC reliability remains measurable.
- Add shadow-only BNB Chain registry and bounded discovery for PancakeSwap v2/v3 and Uniswap v2/v3/v4.
- Add independent Uniswap v2 and PancakeSwap v2/v3 discovery sources on Robinhood Chain without widening execution authority.
- Preserve unknown PancakeSwap v2 fee semantics instead of applying Uniswap's fixed fee.
- Add a credential-free continuous cross-venue shadow that uses protocol Router/QuoterV2 calls at one fixed block,
  subtracts conservative Gas and risk reserves, and publishes a sanitized public snapshot.

- Publish a same-host, group-readable Base runtime heartbeat containing only an explicit operations allowlist, while
  keeping the signer credential, mutation ledger, RPC details, route failures and private heartbeat isolated.

- 增加有界 Base 主网 Uniswap V2/V3 WETH 闭环金丝雀：10-token allowlist、不可变本金/毛利上限、原子无残余结算。
- 增加 root-only/systemd credential Signer、单 nonce fence、同 raw 多 RPC 广播和 receipt/event/WETH/L1 fee 经济对账。
- 增加 36 个 TypeScript 测试、双方向 Solidity 确定性测试，以及对规范 Base V2/V3 合约的主网分叉兼容测试。
- 对 Base L2 Gas、L1 data fee 与 operator fee 做签名前预算和回执后经济对账；更新构建依赖并保持 `npm audit` 零漏洞。
- 增加独立生产 systemd unit、配置模板、ADR 与 UNKNOWN/disarm 运行手册；实现、授权、激活和盈利继续分开陈述。
- 加入 Base 与 Robinhood Chain 的类型化、有界、gap-aware 工厂事件扫描。
- 验证并支持 systemd credential 的 root-owned `0440` 只读挂载，同时继续拒绝可写目录、other-readable 文件和普通宽权限密钥文件。
- 以固定提交在 Base 部署并武装 0.003 WETH 金丝雀合约，完成主网回执、链上配置、systemd、heartbeat 与旧服务恢复读回；激活时尚无套利成交或收益。
- 从 Aerodrome FactoryRegistry 动态核对 Standard 与三代 Slipstream 工厂。
- 用公共 RPC 完成两条链各 250 区块的只读发现窗口，不把池创建事件误报为套利利润。
- 证据序列化省略未定义可选字段，合约 bytecode 在同一明确块高读取。

## 0.1.0 - 2026-09-11

- 建立独立、shadow-only 的任意资产 2–4 跳同链原子套利核心。
- 加入状态一致性、净收益、机会漏斗、来源归因和只读 RPC 测试。
- 登记并只读核验 Base 与 Robinhood Chain 的首批协议合约。
- 加入 Tech Spec、ADR、故事卡、复用台账、CI 与秘密扫描。
