# Base 固定利润门槛移除与实盘生产证据

- 生产变更时间：2026-09-13 13:47–13:57 CST
- 最终链上读回区块：Base `51244879`
- 目标主机：`manga-chan-arb-us-west` / `cbe793c9cb9241ce97752334f65cab48`
- 实盘热路径 release：`74745e4f7dc343d4c98bd9cd236e08f3d877e174`
- 当前策略源码：`4c3d157`（PR #9）
- 公网经营面板：<http://47.251.185.146/>

本文件证明 Base 专用执行器在上述时间已经持有本金、启用并由有签名权限的 watcher 持续运行。它不把本地签名、
正毛利报价、模拟成功或管理交易算成套利收益；Base 套利收益仍只接受规范回执、执行事件、余额变化和全部费用对账
完成的 `RECONCILED_SUCCESS`。

## 结论

Base 路线不是 Shadow。`atomic-cycle-live.service` 加载独立 signer credential，链上执行合约为 `armed=true`，候选
通过最新区块重报价和完整成本门槛后会直接生成计划并广播。Robinhood/BNB 的独立 Shadow 服务仍只用于发现，不是
Base 实盘的验证步骤，也没有 Base signer 或广播权限。

本次把两个固定金额门槛都降为最小正数：

| 门槛                                | 变更前                    | 变更后 | 仍然生效的实际约束                           |
| ----------------------------------- | ------------------------- | -----: | -------------------------------------------- |
| 执行合约 immutable 最低毛利         | `0.000001 WETH`           |  1 wei | 每次调用传入的动态 `minProfit`               |
| watcher 额外最低净利                | `0.000005 WETH`           |  1 wei | L2 Gas、L1 data fee、operator fee 与报价衰减 |
| Gas limit / L1 / operator fee       | 120% / 150% / 120%        |   不变 | 放大后的完整成本                             |
| 可计入的报价毛利                    | 原报价的 80%              |   不变 | 20% 报价衰减缓冲                             |
| 单笔本金 / signer 储备 / 失败 Gas帽 | 0.003 / 0.005 / 0.001 ETH |   不变 | 资本与累计损失熔断                           |

这意味着所有正毛利候选都能进入最新区块重报价和完整 Gas 门禁，不再被人为固定收益额提前拒绝；Gas 调整后不为正的候选
仍不会广播。

## 新执行器与资金迁移

新执行器：`0x002ccD95D1304C6fB88f67183DC1e7d1b90A577F`

部署交易首次广播后，PublicNode 在回执轮询中返回了错误的 archive-token 要求。管理程序按 UNKNOWN 规则停止且没有重发。
随后 Base 官方公共 RPC 与 Tenderly 公共 Base RPC 对同一个哈希返回一致的成功回执、区块和合约地址，才继续迁移。

| 操作             | 交易哈希                                                             | 区块     | 已知总成本 ETH       |
| ---------------- | -------------------------------------------------------------------- | -------- | -------------------- |
| 部署未启用执行器 | `0xf8049ee53a60d678274d61df5b6d0918dc75a9dad5bee637e2c1beb15da0fcb4` | 51244726 | 0.000013122653588031 |
| 停用旧执行器     | `0x3e596713c372d168d87c626da7acb29020b7a6451f9a82692700ba961dc89de9` | 51244795 | 0.000000150523874806 |
| 迁移全部 WETH    | `0x8d9b28db81749d74945b539902b06ec83467f88535254bfac4481e4ea238576b` | 51244797 | 0.000000339619874806 |
| 启用新执行器     | `0x54661e2379f90251fae886c7e7429d9c106c45f9400684751373cd02c7c2ac28` | 51244800 | 0.000000281990145445 |

四笔回执均为成功，已知 L2 Gas、L1 fee 与回执公开的 operator fee 合计
`0.000013894787483088 ETH`。这是一次性部署/迁移成本，不属于套利失败 Gas，也不能记为策略收益。

区块 `51244879` 的独立公共 RPC 读回：

- 旧执行器 `0xb7e829E5146F613A3E8632515573C292dF82A7E2`：`armed=false`、`0 WETH`；
- 新执行器：runtime code 存在、版本匹配、operator 为专用 signer、`armed=true`；
- 新执行器：`maximumAmountIn=0.003 WETH`、`minimumGrossProfit=1 wei`、余额 `0.003 WETH`；
- 10 个 token allowlist 全部启用；
- signer：`0.006959283568921869 ETH`，仍高于 `0.005 ETH` 储备线。

## 首轮完整成本门禁证据

新服务启动后读回：

| 字段                     | 值                         |
| ------------------------ | -------------------------- |
| MainPID / NRestarts      | `21994` / `0`              |
| service                  | `active/running`           |
| heartbeat                | `2026-09-13T05:57:25.633Z` |
| 最新观察区块             | `51244846`                 |
| 本轮检查路线             | `521`                      |
| 毛利为正候选             | `1`                        |
| 本轮最高毛利             | `0.000000013331139048 ETH` |
| 达到完整实盘门槛         | `0`                        |
| 主要拦截原因             | `链上模拟利润低于执行门槛` |
| 本轮广播                 | `false`                    |
| Base 已确认套利 / 净利润 | `0` / `0 ETH`              |
| Base 失败 Gas            | `0 ETH`                    |

这条候选证明一 wei 静态门槛已经生效：它没有再因原 `0.000001 WETH` 固定毛利额度被提前丢弃，而是进入真实执行合约
和动态费用门槛后才被拒绝。为估计 Base L1 data fee，程序可在进程内生成未外发的序列化签名；只有候选通过全部门槛后
才会写入尝试账本并广播。本次 `attempts.jsonl` 不存在，所以没有实盘套利交易、失败回滚或 Gas 支出。

## RPC 与运行时

- 读路径使用 Base 官方公共 RPC；广播/回执使用 Base 官方公共 RPC和本次已验证的 Tenderly 公共 Base RPC；
- 已移除会对普通历史回执错误要求 personal token 的 PublicNode 端点；本次变更不使用 ChainStack 配额；
- 当前 production symlink 与 Base live 进程仍指向 `74745e4`。PR #9 只修改策略默认值、测试和文档；生产通过显式
  `BASE_MIN_CONTRACT_PROFIT_WEI=1`、`BASE_MIN_NET_PROFIT_WEI=1` 运行相同行为，执行器 bytecode 与 ABI 未改变，
  因而没有为了默认值改动再次占用共享主机内存构建；
- release 顶层为 `root:root 0755`，服务用户可进入；此前一次 `0700` 导致的 CHDIR 启动失败已回滚并在运行手册中
  增加发布前 service-user 检查。

北京时间 14:12 后的再次读回仍为 PID `21994`、`NRestarts=0`、`active/running`。最新心跳推进到 Base 区块
`51245305`，本轮 520 条路线、0 条正毛利、0 条完整门槛、0 广播；私有尝试账本仍不存在。观察账本累计记录了
13 条正毛利拒绝证据，最近一条 VIRTUAL 路线从 `116424183128 wei` 重报价为 `115279372743 wei`，随后由动态执行
门槛拒绝；这证明最新区块重报价已实际运行，但不构成交易或收益。

## 经营面板同步

只读面板注册表通过 PR #141 更新到新执行器，GitHub Actions run `34741727321` 成功；生产 release 为
`13193e871c84661b0690f96465dd7642b1e1bba0`，源码归档 SHA-256 为
`791a1a462b31bdb926838da1da67bc51a056c79afe7ddd688f77145ac482ae04`。

发布只暂停 signer-free 看板、报表触发器和 Robinhood/BNB 只读 Shadow；Base PID `21994` 与 Robinhood live PID
`4216` 在构建前后都保持不变且 0 重启。第一次发布在可用内存约 456 MiB 时被 800 MiB 门禁拒绝，第二次因手写错误
commit SHA 得到 404，两次都没有构建或切换；第三次直接使用 Git 权威 SHA，在暂停两个只读服务后以 842,744 KiB
可用内存完成固定提交构建、UI 构建和 314 文件秘密扫描。

生产读回：

- 看板 release symlink、PID `23239` 与 systemd 运行目录均指向 `13193e8`，`NRestarts=0`；
- 健康样本为 `RUNNING / HEALTHY`、4,181 个候选、SQLite `HEALTHY`、parity=true、chain/source catalog 均完整；
- `/api/v1/business` 的 portfolio 为 `VERIFIED`，Base 服务为 `RUNNING`，合约地址为新执行器，余额 `0.003 WETH`，
  operator identity 通过；Base 资金合计为 `0.006959283568921869 ETH + 0.003 WETH`；
- 公网根页面和业务 API 返回 HTTP 200。看板繁忙周期内 loopback `/healthz` 仍可能超时，但静态站点与 30 秒业务缓存
  不依赖该次实时响应；超时不能被写成健康，也不会影响独立 signer 进程。
- 面板当天显示的 3 笔、`0.000091338675933711 ETH` 净收益来自 Robinhood Earn 的规范回执；Base 服务单独显示
  0 笔、0 ETH，二者没有混算。

## 质量门禁

- 多场所执行器与热路径修复：PR #6、#7；生产功能 release 为 `74745e4`；
- Gas-only 净利润门槛：PR #8；
- 同时移除 immutable 固定毛利门槛：PR #9，GitHub Actions run `34741275173` 成功；
- 经营面板跟随新执行器：独立仓库 PR #141，GitHub Actions run `34741727321` 成功；
- 本地 `npm run check`：56 tests，55 passed、1 个只适用于 Linux `/proc` 的场景在 macOS 跳过；Linux CI 实际执行；
- 确定性合约测试：3 条正路径、14 个负向边界、回执与迁移对账通过；
- `npm run test:fork`：Base 区块 `51244469`，Uniswap V2↔V3 与 Uniswap V3↔PancakeSwap V3 四个规范方向均走到
  链上利润门禁，写入仅发生在本地 fork；
- secret scan 通过，没有把 credential、RPC secret、raw transaction 或 webhook 写入仓库。

## 尚未闭环

- Base 至今没有一笔套利 `RECONCILED_SUCCESS`，所以 Base 已实现净利润仍是 `0 ETH`；不能把部署回执、正毛利候选
  或 Robinhood Chain 的既有收益算到 Base；
- 当前 Base 实盘仍仅覆盖 10 个 allowlist token、Uniswap V2/V3 与 PancakeSwap V3 的两池闭环，不等于任意协议和
  3–4 跳已具备签名权限；
- 公共 RPC 已足够维持当前金丝雀，但没有低延迟或 inclusion SLA。需要用真实候选的 wire timing、漏失率和
  `RECONCILED_SUCCESS` 分母判断是否恢复 ChainStack 热路径，而不是按扫描数量采购。
