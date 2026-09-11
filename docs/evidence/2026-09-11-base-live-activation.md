# Base V2/V3 实盘金丝雀激活证据

时间：2026-09-11 19:11 CST

本文件记录一次生产激活的可公开证据。它证明指定版本、合约与 watcher 已在当时上线，不承诺未来在线率、机会频率或盈利。

## 版本与门禁

- 公开仓库：<https://github.com/MeiYanDong/atomic-cycle-engine>
- 生产 release：`e2a27f1fd14ec63986dd71a996542ea4da5634ee`
- GitHub Actions：<https://github.com/MeiYanDong/atomic-cycle-engine/actions/runs/34591714223>，结论 `success`
- 本地 `npm run check`：36/36 TypeScript 测试通过，Solidity 双向正路径、13 个拒绝边界和秘密扫描通过
- `npm run test:fork`：Base chain ID 8453；规范 WETH/Uniswap V2/V3 双向均走到链上利润门禁；写入仅发生在本地 fork
- `npm audit --audit-level=low`：0 vulnerabilities
- Sniper Engineering 外部规格 validator：`VALID`

## 主网回执

专用 signer：`0xb756c304B5411B6dC3e7A6CBCD512Fad8eB6Dca7`

执行合约：`0x5EA444843137c1d38D459a4862f3A3d798B49EeA`

### 部署与注资

- 交易：<https://basescan.org/tx/0x6786c4a542a89e9896312b97931a076efa92b41e50de800c02c2c668289d1435>
- Base 区块：`51167283`
- receipt status：success
- runtime bytes：`7985`
- runtime code hash：`0x85ec870ae0cac1fb9fa2825330787d58b7ae253eb7d2d9c0bfd6801e1a42639f`
- 合约初始 WETH：`0.003`
- L2 Gas：`12615510000000 wei`
- L1 data fee：`28003718391 wei`
- operator fee：`0 wei`

部署后读回为：operator 与 signer 一致、`armed=false`、本金上限 `0.003 WETH`、最低合约毛利 `0.000001 WETH`、10 个 token 全部在 allowlist。

### 单独武装

- 交易：<https://basescan.org/tx/0x66f3e91aab769da80f25aed43ba1f1828efe01ebf75ac352b055a521529ce065>
- Base 区块：`51167342`
- receipt status：success
- L2 Gas：`281178000000 wei`
- L1 data fee：`672254378 wei`
- operator fee：`0 wei`
- 链上读回：`armed=true`

两笔生产管理交易合计已知成本为 `0.000012925363972769 ETH`。激活后 signer 余额为 `0.006987074636027231 ETH`，高于 `0.005 ETH` 储备下限；合约持有 `0.003 WETH`。

## 服务器运行时读回

- SWAS：`manga-chan-arb-us-west` / `cbe793c9cb9241ce97752334f65cab48`
- 独立服务：`atomic-cycle-live.service`
- release、状态目录、配置目录、systemd unit、服务用户和 signer credential 均与现有 MANGA 服务隔离
- `systemctl is-enabled`：enabled
- `systemctl is-active`：active
- 读回时 MainPID：`777`
- 读回时 `NRestarts=0`、`Result=success`
- `manga-dual-watcher.service` 与 `manga-opportunity-board.service` 均为 active

四次连续 heartbeat 的观察区块从 `51167829` 推进至 `51167867`。每轮检查 350 条路线；最新读回为：

```text
运行状态          实盘监控中
毛利为正候选      0
是否广播          false
确认盈利交易      0
确认回滚交易      0
累计净利润        0 ETH
累计失败 Gas      0 ETH
RPC 异常源        0
```

没有生成 `attempts.jsonl`，因为 watcher 尚未遇到一条通过正毛利和完整净利润门禁的候选。部署/arm 的管理 Gas 属于上线成本，不是套利失败 Gas，也不是套利收益。

## 故障与恢复证据

首次启动时，systemd 将 credential 以 root-owned `0440` 文件挂载在 root-owned `0550` 目录；旧加载器只接受普通 `0600` 文件，因此安全退出，未进入扫描、签名或广播。修复增加了 systemd credential 专用边界检查及两个测试，仍拒绝可写目录、other-readable 文件和普通宽权限密钥。

随后 release 命令在依赖裁剪后使 Cloud Assistant/SSH 管理通道失去响应，实例长期停留在 graceful `Stopping`。对已核对的唯一实例执行 force-stop 后再启动；磁盘上的正确 release 已完成切换。恢复读回确认新 watcher、两个旧 MANGA 服务和 Cloud Assistant 均正常。

## 尚未闭环

- 当前合约没有独立第三方审计，不能据此扩大 `0.003 WETH` 上限。
- 实盘只覆盖 10 个 allowlist token 的规范 Uniswap V2/V3 两池 WETH 闭环，不是任意协议或 3–4 跳实盘。
- `base-rpc.publicnode.com` 对历史 receipt 请求返回 archive-token 限制；官方 Base RPC 可读该回执，实时扫描读回暂未出现 RPC 异常。公共 RPC 的机会漏失率仍未量化。
- 尚无套利成交，因此当前已实现净利润为 `0 ETH`；只有账本中的 `RECONCILED_SUCCESS` 才能改变该结论。
