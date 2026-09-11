# Base V2/V3 实盘金丝雀运行手册

本手册只适用于 ADR 0002 的专用地址和有界 Base Canary。任何命令通过不等于链上已成交或已盈利。

## 发布顺序

1. 在本地固定提交并通过 `npm ci && npm run check && npm run test:fork`。
2. 服务器以该提交创建只读 release，执行 `npm ci --no-audit --no-fund`、`npm run contract:compile`、`npm run build`，再把 `/opt/atomic-cycle-engine/current` 原子切换到该 release。
3. 安装 `deploy/systemd/atomic-cycle-live.service`，创建无交互用户 `atomic-cycle`、状态目录 `/var/lib/atomic-cycle-engine` 和配置目录 `/etc/atomic-cycle-engine`。
4. 私钥只放在 `/etc/atomic-cycle-engine/base-signer.key`，要求 root:root、`0600`、普通文件且非符号链接。非敏感参数放在 `/etc/atomic-cycle-engine/live.env`。
5. 先用 `BASE_SIGNER_CREDENTIAL_FILE=/etc/atomic-cycle-engine/base-signer.key npm run live:admin -- wallet` 核对地址与 Base ETH 余额。
6. 到账且余额满足资金边界后，设置授权 ID 并运行 `npm run live:admin -- deploy`。保存部署哈希与合约地址，链上读回必须为 `DISARMED`。
7. 把读回的地址写入 `BASE_EXECUTOR_ADDRESS`，再次运行 `status`，然后单独运行 `arm` 并保存 arm 回执。
8. 只有上述读回成功后才创建 `/etc/atomic-cycle-engine/LIVE_APPROVED`，启用并启动 systemd 服务。

当前目标 SWAS 主机的 Node 固定路径是 `/usr/local/bin/node`；发布前必须运行 `systemd-analyze verify`，不能假设发行版默认的 `/usr/bin/node` 存在。

## 激活后读回

至少核对：

```bash
systemctl is-enabled atomic-cycle-live.service
systemctl is-active atomic-cycle-live.service
systemctl show atomic-cycle-live.service -p MainPID -p NRestarts -p Result
journalctl -u atomic-cycle-live.service --since '-10 min' --no-pager
cat /var/lib/atomic-cycle-engine/heartbeat.json
```

状态必须同时满足：service 为 `active`、MainPID 非零、最近 heartbeat 为“实盘监控中”、钱包和合约与链上读回一致。没有 `EFFECT/RECONCILED_SUCCESS` 时，收益仍为零，不得把“发现毛利候选”算成收益。

## 停止与恢复

正常停止先执行 `systemctl stop atomic-cycle-live.service`，确认 nonce fence 已释放，再运行 `live:admin -- disarm`。不要在 watcher 持有 nonce fence 时并行发管理交易。

若出现 `UNKNOWN`、`DISPUTED`、Gas 熔断或未知 pending nonce：保持服务停止；先用多个 RPC 核对同一个交易哈希、规范回执、合约 WETH 余额、L1 data fee、operator fee 和账户 nonce。禁止通过重新签一笔相同交易“试试看”。明确对账完成后才允许恢复。

回滚代码只允许回到兼容当前链上合约和账本 schema 的已验证提交；代码回滚不会撤销链上合约或已签交易。紧急降险的权威操作是停止 watcher 并把执行合约设为 disarmed。
