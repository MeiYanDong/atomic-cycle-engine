# Robinhood Earn/DEX 与 BNB 多协议路线簿生产证据

- 生产变更时间：2026-09-13 16:25–16:28 CST
- 目标主机：`manga-chan-arb-us-west` / `cbe793c9cb9241ce97752334f65cab48`
- 公网地址：<http://47.251.185.146/>
- 功能 release：`8b67df7e9bc97acc9ddb95c63e21957bda61b2a5`（PR #11）
- 源码归档 SHA-256：`8b0da60dfc608126875fe5657d77c50dd94b86c64ba4ac608e2b6314eb5daee1`
- 证据等级：生产运行读回、固定块链上报价和既有 Robinhood 成交回执

本次把 Robinhood Chain 提升为首要发现来源，并把 BNB Chain 作为第二来源。新增路线会在生产服务器持续报价，
但没有把只读报价器伪装成实盘执行器：既有 Robinhood Earn watcher 继续持有原有实盘授权；Robinhood
Earn/DEX 混合路线和全部 BNB 路线目前没有 typed calldata executor、signer 或广播权限，因此不能成交。

## 发布与运行读回

固定提交通过本地门禁和 GitHub Actions 后，服务器从同一提交创建只读 release，完成依赖安装、TypeScript 构建和
秘密扫描，再原子切换 `/opt/atomic-cycle-engine/current`。最终读回：

| 项目                              | 生产结果                                                     |
| --------------------------------- | ------------------------------------------------------------ |
| GitHub Actions                    | PR run `34745668071`、main run `34745741051`，均为 `SUCCESS` |
| `atomic-cycle-shadow.service`     | `active`，PID `31398`，`NRestarts=0`                         |
| `atomic-cycle-live.service`       | `active`，PID `31489`，`NRestarts=0`                         |
| `manga-dual-watcher.service`      | `active`，PID `30618`，`NRestarts=0`                         |
| `manga-opportunity-board.service` | `active`，PID `31481`，`NRestarts=0`                         |
| Robinhood 实盘状态                | `RUNNING`、`ARMED`、授权期限 `UNTIL_REVOKED`                 |
| Base 实盘状态                     | `RUNNING`、fence schema v2、尝试账本 0、未决交易 0           |
| 最近部署后 warning / failed unit  | `0 / 0`                                                      |
| 公网根页面与业务 API              | HTTP 200                                                     |

最终统一读回时间为 `2026-09-13T08:28:43Z`。Base 心跳推进到
`2026-09-13T08:28:32.013Z`，本轮检查 526 条路线，6 条毛利为正、0 条通过完整实盘门槛、0 广播、已确认净收益
0、失败 Gas 0。毛利观察没有计入收益。

`2026-09-13T08:34:58Z` 的持续性复核仍为同一 release 和 PID，四个服务均为 `active/running`、0 重启；公网首页、
经营、机会和每日利润 API 均返回 HTTP 200。此时 Robinhood/BNB Shadow 都是 `CURRENT`，未解决的报价失败均为 0。

## 连续生产报价结果

第二个完整 Shadow 周期已消除首轮公共 RPC 的部分失败，两条链均为 `CURRENT`：

| Chain     |       Block | 尝试报价 | 完整报价 | 毛利为正 | Gas 调整后为正 | 可执行 |
| --------- | ----------: | -------: | -------: | -------: | -------------: | -----: |
| Robinhood |  61,814,292 |      123 |       48 |        5 |              0 |      0 |
| BNB       | 121,613,682 |       82 |       72 |        2 |              0 |      0 |

Robinhood 最优观察路线为 `WETH → AI → WETH`，先走 Uniswap V3，再走 Earn stock/meme 池。以
`0.0005 WETH` 观察本金报价：

- 毛利：`+0.000017202938540204 WETH`；
- 保守 Gas：`0.0000520152 WETH`；
- 风险准备：`0.0000005 WETH`；
- 估算净值：`-0.000035312261459796 WETH`。

BNB 最优观察路线为 `WBNB → CAKE → USDT → WBNB`。以 `0.0025 WBNB` 观察本金报价：

- 毛利：`+0.000000671887241266 WBNB`；
- 保守 Gas：`0.00004 WBNB`；
- 风险准备：`0.0000025 WBNB`；
- 估算净值：`-0.000041828112758734 WBNB`。

两条路线都在 Gas 和风险准备后转负，因此没有交易。更大金额档位只有在同路线组仍为毛利正数时继续探测；这是报价
阶梯，不是资金上限。

## 已实现收益边界

`/api/v1/profit/daily` 在最终读回时显示：

- 2026-09-13：Robinhood Earn 既有实盘 3 笔，回执口径净收益
  `0.000091338675933711 ETH`，失败交易 0，失败 Gas 0；
- 2026-09-12：5 笔，交易净收益 `0.000317402701771984 ETH`，扣除已知项目成本后为
  `0.000305958015667984 ETH`。

这些收益来自既有 Robinhood Earn watcher 的规范成交回执，不来自本次新增的混合路线或 BNB 路线。因共享运营成本
覆盖仍不完整，经营口径净利润继续标记为 `UNKNOWN`，不能用交易净收益替代。

## ENOSPC 恢复证据

部署前审计发现根卷仍有约 3.9 GiB 可用空间，但 inode 已达 100%，Robinhood watcher 在
`15:56 CST` 因无法原子写入状态文件而退出。授权仍为 `ARMED / UNTIL_REVOKED`，锁、尝试账本和代码身份核对后没有
未决交易。

只删除了 9 个未被当前/回滚 symlink 引用、且可从 GitHub 对应提交重建的最旧 MANGA release；没有删除状态、账本、
credential 或当前 release。恢复后根卷约 6.0 GiB 可用、218,454 个 inode 可用，Robinhood watcher 重新进入
`RUNNING`。服务器仍保留 76 个 MANGA release，因此自动留存策略尚未闭环。

Base 正常停止在 systemd 的 20 秒窗口内未完成，被 SIGKILL 后遗留旧 nonce fence。恢复前逐项确认 unit 已停止、旧
PID 不存在、尝试账本为 0 且没有未决交易，随后只删除该精确 fence；新进程已创建 schema v2 fence 并通过
PID/boot ID/start tick 读回。这个受证据约束的恢复不是允许通用地删除锁文件。

## 仍未闭环

1. Robinhood Earn/DEX 混合路线和 BNB 路线仍是生产只读报价；没有 typed atomic executor 前不能称为实盘。
2. BNB 没有专用执行本金，也不应在 0 条净正收益候选时充值。
3. 公共 RPC 首轮曾出现部分报价失败；当前样本不足以证明长期漏失率，也不足以购买付费热路径。
4. 共享主机 release inode 留存尚未自动化；在闭环前每次发布必须同时检查空间和 inode。
5. 当日交易净收益可核验，但共享运营成本覆盖不完整，经营净利润仍为 `UNKNOWN`。
