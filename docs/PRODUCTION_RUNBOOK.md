# Base 多场所实盘金丝雀运行手册

本手册只适用于 ADR 0002 的专用地址和有界 Base Canary。任何命令通过不等于链上已成交或已盈利。

## 发布顺序

1. 在本地固定提交并通过 `npm ci && npm run check && npm run test:fork`，并等待同一 merge commit 的 GitHub
   Actions `quality` job 成功。生产机不重复承担完整测试矩阵；CI 才是合并门禁。
2. 服务器以该提交创建只读 release，验证源码归档哈希、`package-lock.json` 和 commit identity。生产机只执行
   release 构建与秘密扫描；两者成功前不得切换 `/opt/atomic-cycle-engine/current`。
3. 安装 `deploy/systemd/atomic-cycle-live.service`，创建无交互用户 `atomic-cycle`、状态目录 `/var/lib/atomic-cycle-engine` 和配置目录 `/etc/atomic-cycle-engine`。
4. 私钥只放在 `/etc/atomic-cycle-engine/base-signer.key`，要求 root:root、`0600`、普通文件且非符号链接。非敏感参数放在 `/etc/atomic-cycle-engine/live.env`。
5. 先用 `BASE_SIGNER_CREDENTIAL_FILE=/etc/atomic-cycle-engine/base-signer.key npm run live:admin -- wallet` 核对地址与 Base ETH 余额。
6. 到账且余额满足资金边界后，设置授权 ID 并运行 `npm run live:admin -- deploy`。保存部署哈希与合约地址，链上读回必须为 `DISARMED`。
7. 把读回的地址写入 `BASE_EXECUTOR_ADDRESS`，再次运行 `status`，然后单独运行 `arm` 并保存 arm 回执。
8. 只有上述读回成功后才创建 `/etc/atomic-cycle-engine/LIVE_APPROVED`，启用并启动 systemd 服务。
9. 若同机的只读经营面板需要 Base 运行摘要，仅读取 `/run/atomic-cycle-portfolio/heartbeat.json`。该文件只有白名单字段；不得放宽 `/var/lib/atomic-cycle-engine`、签名凭据或尝试账本的权限。

### 从旧 V2/V3 执行器迁移

1. 正常停止旧 watcher，确认 attempts ledger 无未决交易且 nonce fence 已释放。`deploy-next` 和迁移都使用同一 signer nonce，不能与 watcher 并发。
2. 用新 release 的 `live:admin -- deploy-next` 部署无本金、未启用的新执行器；核验版本、runtime bytecode、operator、策略边界和完整 token allowlist。
3. 执行 `live:admin -- migrate <新执行器地址>`。命令按顺序停用旧执行器、把旧执行器全部 WETH 转入新执行器、核对源/目标余额、启用新执行器；任一步回执未知都会停止。
4. 将 `BASE_EXECUTOR_ADDRESS` 持久化为新地址后再切换 release 并启动 watcher。读回心跳中的合约地址、三个实盘场所、PID、fence 与链上余额。
5. 旧执行器保持停用。若新 watcher 启动失败，先停用新执行器；不得把旧代码指向新 ABI，也不得在两个执行器上同时运行同一 signer。

当前目标 SWAS 主机的 Node 固定路径是 `/usr/local/bin/node`；发布前必须运行 `systemd-analyze verify`，不能假设发行版默认的 `/usr/bin/node` 存在。

### 共享主机资源门禁

当前 SWAS 没有 swap，且与 MANGA 实盘、机会看板和经营报表共用内存。禁止在
`manga-opportunity-board.service` 运行时执行 `npm ci`、完整 `npm run check` 或 TypeScript release 构建。2026-09-13
生产证据表明，即使 Node 堆限制为 320 MiB，`tsc` 仍会因自身堆耗尽而退出；看板暂停后使用 512 MiB 堆限制可完成
构建。

共享主机发布必须满足以下顺序：

1. 读回 live/shadow 的 PID、release、未决尝试账本和当前 fence；确认旧 release 仍可回滚；同时检查 `df -h` 和
   `df -i`。容量充足而 inode 耗尽同样会阻止状态文件原子落盘；
2. 暂停只读看板及 `manga-business-report.timer/path/service`，不停止 Robinhood 或 Base 实盘执行器；
3. 确认 `MemAvailable` 至少 800 MiB，否则终止发布，不用 OOM 试探主机；
4. 对固定 commit 构建，使用 `NODE_OPTIONS=--max-old-space-size=512`；release 顶层目录必须为 `root:root 0755`，并在切换前以 `atomic-cycle` 用户验证可进入且可读取启动文件；成功后再原子切换 release；
5. 先重启并读回无签名 Shadow，再正常停止 Base live、确认旧 fence 已释放和无未决交易，然后启动新 live；
6. 新 live 必须读回 schema v2 fence，且 PID、boot ID、process start ticks 与 `/proc` 一致；
7. 恢复看板和报表触发器，等待目录完整、持久化一致和至少两个新的 Shadow 周期，再接受发布。

任何步骤失败都必须恢复被暂停的只读服务，并保持 release symlink 指向最后一个已验证版本。当前发布仍由人工通过
Cloud Assistant 编排；其默认解释器是 POSIX `/bin/sh`，不能直接使用 `set -o pipefail` 等 Bash-only 语法。若脚本
需要 Bash，必须显式调用并先通过语法检查。仓库尚未产出可直接下载的 CI release artifact，因此不能把现状描述为
自动 CD。

看板可能通过依赖关系被其他 unit 自动拉起。低内存构建窗口必须先检查 unit dependency；必要时临时 mask 只读看板，
构建后恢复原状态。不得 mask、停止或改写实盘执行器来换取构建资源。

release 清理不是普通发布步骤。只有在 inode/容量门禁失败时，才允许删除同时满足以下条件的目录：不被 current 或已知
rollback symlink 引用、目录名是可在 GitHub 核验的完整提交、归档可按固定提交重建。先列出精确目录并保存读回；禁止
对 `/opt`、releases 根目录、状态目录或通配目标递归删除。当前还没有自动留存策略，因此每次发布都必须人工执行此门禁。

## Robinhood/BNB 只读 Shadow

`deploy/systemd/atomic-cycle-shadow.service` 与 Base Signer 完全独立。它使用专用的
`atomic-cycle-shadow` 无登录用户、公开 RPC 和 `/var/lib/atomic-cycle-shadow/public.json`，不加载 EnvironmentFile、
credential、钱包、执行合约或交易账本。部署顺序：

1. 完成相同的固定提交、`npm ci`、`npm run check` 与构建；
2. 创建系统用户并安装 unit，运行 `systemd-analyze verify`；
3. 启动服务，等首轮文件生成后核对文件为 `0644`、目录为 `0755`；
4. 核对 JSON 中 `signingEnabled=false`、`broadcastEnabled=false`、每链状态与块承诺；
5. Nginx 只能静态只读暴露该文件。服务 `PARTIAL` 时页面必须显示不完整，不能写成零机会。

Shadow 可以与 Base live canary 同机运行，因为它们没有共享用户、状态目录、凭据、nonce owner 或写路径。升级
Shadow 不得重启或改写 Base live unit。

生产 unit 默认设置 `ATOMIC_CYCLE_SHADOW_NETWORK=robinhood`，只运行 Robinhood 路线，避免 BNB 读取和报价与
当前实盘争用计算与 RPC 预算。恢复 BNB 前必须先重新核对它的独立正净收益证据，然后通过受审计的
systemd 配置把该值改回 `all`；不得在运行中直接启动第二个 Shadow 写同一个快照文件。

## 激活后读回

至少核对：

```bash
systemctl is-enabled atomic-cycle-live.service
systemctl is-active atomic-cycle-live.service
systemctl show atomic-cycle-live.service -p MainPID -p NRestarts -p Result
journalctl -u atomic-cycle-live.service --since '-10 min' --no-pager
cat /var/lib/atomic-cycle-engine/heartbeat.json
cat /run/atomic-cycle-portfolio/heartbeat.json
```

状态必须同时满足：service 为 `active`、MainPID 非零、最近 heartbeat 为“实盘监控中”、钱包和合约与链上读回一致。没有 `EFFECT/RECONCILED_SUCCESS` 时，收益仍为零，不得把“发现毛利候选”算成收益。

公开心跳 schema v2 只是同机、组可读的只读投影；它区分“毛利为正”和“通过完整实盘门槛”，并只发布白名单化的主要拦截原因。它不包含 RPC、私钥、raw transaction、完整路线或错误原文，也不替代私有账本和链上回执对账。

## 停止与恢复

正常停止先执行 `systemctl stop atomic-cycle-live.service`，确认 nonce fence 已释放，再运行 `live:admin -- disarm`。不要在 watcher 持有 nonce fence 时并行发管理交易。

若出现 `UNKNOWN`、`DISPUTED`、Gas 熔断或未知 pending nonce：保持服务停止；先用多个 RPC 核对同一个交易哈希、规范回执、合约 WETH 余额、L1 data fee、operator fee 和账户 nonce。禁止通过重新签一笔相同交易“试试看”。明确对账完成后才允许恢复。

`nonce-owner.lock` 的 schema v2 同时绑定 Linux boot ID、PID、`/proc/<pid>/stat` 启动 tick 与随机 owner token。服务重启前不得只凭“锁里的 PID 当前存在”判断旧 owner 仍存活；操作系统重启后 PID 可能被云助手等无关进程复用。旧 schema 锁只有在记录时间明确早于当前 boot（保留一分钟时钟偏差）或 PID 已不存在时才会自动迁移，否则继续失败关闭。删除锁前仍须确认对应 systemd unit 没有进程且 `attempts.jsonl` 没有未决交易。

systemd 的停止超时可能在 watcher 完成清理前发送 SIGKILL。出现遗留 fence 时不得反复重启或直接删除：先确认 unit 为
inactive、MainPID 和 fence PID 均不存在，再核对 ledger 不存在 `PLANNED`、`SIGNED`、`BROADCAST` 或其他未决终态；
只有三项均成立才可删除该精确 fence。新进程启动后必须重新核对 schema v2、PID、boot ID 与 process start ticks。

回滚代码只允许回到兼容当前链上合约和账本 schema 的已验证提交；代码回滚不会撤销链上合约或已签交易。紧急降险的权威操作是停止 watcher 并把执行合约设为 disarmed。
