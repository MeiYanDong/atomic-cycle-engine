# 公共 RPC 重试与重启安全锁生产发布证据

- 时间：2026-09-13 03:58 CST
- 生产功能版本：`4cb4a2f8fe9d694e692fd1dccd64b3f8696c7475`
- 上一个可回滚版本：`f72e3b5727a7ae023b87fee6ccb18b4cb41bcee6`
- 目标主机：`manga-chan-arb-us-west` / `cbe793c9cb9241ce97752334f65cab48`
- 公网经营面板：<http://47.251.185.146/>

本证据只证明固定版本、运行时与当时公开读模型一致。它不承诺未来机会频率、盈利或公共 RPC 在线率。

## 发布结果

`/opt/atomic-cycle-engine/current`、Base live 进程工作目录和 Robinhood/BNB Shadow 进程工作目录均解析到
`4cb4a2f8fe9d694e692fd1dccd64b3f8696c7475`。此次发布没有转移资金、修改链上授权、加载新的 signer，或给
Robinhood/BNB Shadow 增加签名和广播能力。

发布后运行时读回：

| 服务                              | MainPID | NRestarts | 状态           | 版本/边界                                  |
| --------------------------------- | ------: | --------: | -------------- | ------------------------------------------ |
| `atomic-cycle-live.service`       |    2281 |         0 | active/running | Base 既有实盘授权；新 fence                |
| `atomic-cycle-shadow.service`     |    2207 |         0 | active/running | Robinhood/BNB 只读；sign/broadcast=false   |
| `manga-dual-watcher.service`      |     810 |         0 | active/running | Robinhood 既有实盘执行器                   |
| `manga-opportunity-board.service` |    2326 |         0 | active/running | `d948ac56003554b2912d3f5cb5738a1ea358756f` |
| `nginx.service`                   |     863 |         0 | active/running | 公网只读入口                               |

经营报表 timer/path 均为 active。机会看板重新完成 4,096 个候选目录，chain/source catalog 均为
`COMPLETE_FROM_CONFIGURED_START`，SQLite 持久化状态为 `HEALTHY` 且 parity 为 true。公网根页面和两个只读 API
返回 200；对利润 API 的 POST 返回 403。

## Shadow 读回

首次新版本快照生成于 `2026-09-12T19:51:23.602Z`。其后两个完整周期
`2026-09-12T19:55:30.384Z` 和 `2026-09-12T19:57:33.617Z` 均满足：

- Robinhood Chain 与 BNB Chain 都是 `CURRENT / NONE`；
- `failedProviderRequests=0`、`recoveredTransportRequests=0`、`unresolvedQuoteFailures=0`；
- Robinhood 为 36 条尝试闭环、14 条完整报价；BNB 为 36 条尝试闭环、26 条完整报价；
- 两条链的 Gas 调整后正利润与可执行闭环均为 0。

首轮 BNB 曾出现 1 条毛利为正路线，但计入 Gas 与风险储备后仍为负，因此没有授权、签名或广播。新版本已经公开
逻辑 provider 请求、实际 provider 尝试、transport 失败、成功恢复和最终失败的独立计数；观察窗口没有恰好触发
transport 重试，所以只能证明生产路径与边界已经上线，不能虚构“已在生产成功恢复一次”。

## Base live fence 读回

切换前 Base live 使用旧版本 PID 1569，`attempts.jsonl` 不存在，旧 schema fence 在正常停止时被释放。切换后新
PID 为 2281，`NRestarts=0`，新锁摘要为：

```json
{
  "schemaVersion": 2,
  "pid": 2281,
  "hasBootId": true,
  "hasProcessStartTicks": true,
  "hasOwnerToken": true
}
```

锁中的 PID、Linux boot ID 和 process start ticks 与当前 `/proc` 读回完全一致；owner token 只验证存在和长度，未
输出原值。启动后仍无 Base 尝试记录，因此此次代码发布本身没有产生交易或 Gas。

## 同机实盘经济读回

北京时间 2026-09-13 的公开收据门禁利润快照在 `2026-09-12T19:56:01.999Z` 显示 Robinhood Earn 路径新增
2 笔确认交易、0 笔失败，合计净结果为 `0.000055127296042588 ETH`：

- `WETH -> AI -> WETH`：<https://robinhoodchain.blockscout.com/tx/0xa50b7125721a0ed60c68d929ad3347d621f71377ee445f59c6d1f2c4e587bd44>，净结果 `0.000026757162131997 ETH`；
- `WETH -> MOO -> AI -> WETH`：<https://robinhoodchain.blockscout.com/tx/0x7f216ff7edf2cf789d51c5af96eac6b4889bcdaefac6ac9d1163f5bab029d1ba>，净结果 `0.000028370133910591 ETH`。

两笔记录均带 canonical receipt 与余额效果，Gas 标记为已包含在结果中。它们来自既有
`manga-dual-watcher.service`，不是本次 Base fence 发布创造的收益，也不是 Shadow 模拟收益。项目覆盖仍为
`PARTIAL`，完整经营净利润因运营成本覆盖不全保持 `UNKNOWN`。

独立使用 Robinhood Chain 官方公共 RPC 读回同一哈希，分别得到 receipt `status=0x1`、区块 61,355,058
和 61,360,391；两笔交易的发送地址均为 `0x77f771e83f118c32547a1291dda438a757b4b91b`，目标均为
`0x2d6dd5a990a643a8b11cd06554fbc290a1a82ba6`。公开 RPC 的成功回执与经营账本一致，但净利润仍以事件和余额效果
对账后的经营读模型为准，不能仅由 receipt status 推导。

## 事故、拒绝路径与恢复

较早一次 `aaf79f0` 发布尝试在机会看板仍占用大量内存时，于这台无 swap 的共享主机执行安装/构建，使管理与公网
通道失去响应。release symlink 当时没有离开 `f72e3b5`。通过 SWAS 控制面 force-stop/start 恢复后，Linux 把旧
fence 中的 PID 779 分配给无关的 `aliyun.service` 进程；旧代码只检查 PID 是否存在，因而安全失败并拒绝启动。

恢复时先确认 Base 服务失败、该 PID 的 cgroup 与服务无关、`attempts.jsonl` 不存在，再只删除精确的旧
`nonce-owner.lock` 并启动旧版本。没有删除交易账本、重新签名或广播。此根因对应 ADR 0005 和版本 `4cb4a2f`。

最终发布先暂停看板和报表触发器。第一次把 Node 堆限制为 320 MiB 的 `tsc` 以 exit 134 退出；旧 release 与两条
实盘执行器均未切换。把堆限制提高到 512 MiB 后，固定 commit 构建和秘密扫描通过，再依次切换 Shadow 与 Base
live，最后恢复看板和报表。源码归档 SHA-256 为
`73aa28f65e9bd9b16e9be25f1e1d25f03ded9b2a52b73a8c257dd2844df44d88`，锁文件 SHA-256 为
`8d962e7259495a1f2c3ed874836a5215d24d6404c40d46e10e915c48bf6ee08e`。

接受发布后删除了精确的失败中间 release `aaf79f0`（206,501,708 bytes）和暂存源码归档（150,085 bytes）；两者
不是运行时状态且不可原地恢复，但 GitHub commit 仍可重建。已验证的 `f72e3b5` release 保留为代码回滚点。

## 质量门禁

- 公共 RPC 有界重试：PR <https://github.com/MeiYanDong/atomic-cycle-engine/pull/3>；main CI
  <https://github.com/MeiYanDong/atomic-cycle-engine/actions/runs/34713951640> 为 success。
- 重启安全 fence：PR <https://github.com/MeiYanDong/atomic-cycle-engine/pull/4>；main CI
  <https://github.com/MeiYanDong/atomic-cycle-engine/actions/runs/34715086885> 为 success。
- Linux CI 完整执行格式、lint、类型、规格、Solidity 编译、51/51 TypeScript 测试、确定性合约测试和秘密扫描；
  其中包含本次开机 PID、旧开机 PID 复用、owner token/inode 释放边界。
- macOS 本地完整门禁为 50 passed、1 skipped；跳过项只是在非 Linux 无法构造精确 `/proc` PID 复用，Linux CI
  已实际执行并通过该测试。
- 生产机只执行固定 commit 的 release build 与 secret scan，两者通过；完整测试以同 merge commit 的 CI 为准。

## 尚未闭环

- 当前 CD 仍由 Cloud Assistant 人工编排，尚无可下载、签名并直接部署的 CI release artifact。
- 公共 RPC 的重试路径已由测试覆盖，但本次生产观察窗口没有出现 transport failure；其长期恢复率仍需累计。
- Robinhood/BNB 仍是只读 Shadow，0 条 Gas 调整后正机会，不应充值 BNB 或新增 signer。
- Base live 当前没有尝试或收益；新增协议、3–4 跳 calldata 与事件驱动热路径仍属于 S4，不得把当前 V2/V3
  canary 宣传为通用多池实盘。
