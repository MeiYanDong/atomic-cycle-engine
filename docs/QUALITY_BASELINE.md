# 工程质量基线与未闭环项

更新时间：2026-09-11

## 已满足

| 要求           | 证据                                                   | 当前结论                                                                                  |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 高风险边界测试 | `test/*.test.ts`、`scripts/base-contract-test.mjs`     | 34/34；合约双向正路径、13 个拒绝边界和回执经济对账均通过                                  |
| 主网分叉测试   | `scripts/base-fork-test.mjs`                           | 规范 Base WETH/Uniswap V2/V3 双向均走到链上利润门禁，写入仅发生在本地 fork                |
| 自动化门禁     | `npm run check`                                        | format、lint、Solhint、typecheck、spec、compile、test、secret scan 串行失败关闭           |
| 合并前 CI      | `.github/workflows/ci.yml`                             | PR/push 自动运行 `npm ci` 与 `npm run check`；尚未推送，因此云端 Actions 状态为 `NOT_RUN` |
| 文档与设计决策 | `docs/TECH_SPEC.md`、`docs/decisions/0001-*`、`0002-*` | 通用 shadow 与受限 Base 实盘例外、边界、晋级条件和取舍均已记录                            |
| 清晰故事卡     | `docs/STORIES.md`                                      | 通用研究、Base 金丝雀与尚未实现的通用多池实盘分别定义并可独立验收                         |
| 统一代码风格   | Prettier + ESLint                                      | 本地门禁已通过                                                                            |
| 依赖安全       | `npm audit --audit-level=low`                          | 0 vulnerabilities；高风险交易运行时仅依赖 `viem`，编译/测试依赖不进入 systemd 热路径      |
| 外部机制规格   | `spec/sniper-spec.json`                                | Sniper v1.4 validator：VALID，0 error，0 warning                                          |
| 只读链上核验   | `docs/evidence/2026-09-11-phase1a-bounded-census.md`   | Base 17/17、Robinhood 7/7 地址有 bytecode；Aerodrome 4 个批准工厂与配置一致               |
| 有界池发现     | 同上                                                   | 两条链各 250 区块、所有配置来源无 gap；Base 25 facts，Robinhood 0 facts                   |
| 实盘安全边界   | `contracts/BaseV2V3CycleExecutor.sol`、ADR 0002        | 固定链/工厂/WETH、10-token allowlist、0.003 WETH 上限、链上毛利下限、撤防式提款           |
| 生产运行定义   | `deploy/systemd/atomic-cycle-live.service`、运行手册   | 独立用户/目录/凭据、nonce fence、失败熔断、UNKNOWN fail-closed 和运行时读回已定义         |

## 缺口、影响与优先级

| 优先级 | 缺口                                                                   | 影响                                                |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------- |
| P0     | Base 实盘仍待主网部署/arm 收据和 systemd 读回                          | 代码与 fork 通过仍不能证明已经实盘；上线前必须闭环  |
| P0     | 当前实盘只覆盖 Base Uniswap V2/V3 两池和 10 个 allowlist token         | 不能把它宣传为任意协议、3–4 跳或全市场执行器        |
| P0     | Factory/PoolManager 只有有界窗口，持久游标与 gap-free 全历史回填未实现 | 无法证明通用池全集与长期机会频率                    |
| P0     | v4/Aerodrome 等协议没有 typed live calldata/risk adapter               | 这些来源只能观察，不能安全进入实盘交易              |
| P0     | 机会半衰期、竞品胜者和 wire timing 未测量                              | 无法判断公共 RPC 漏失率或付费 RPC 的边际价值        |
| P1     | 当前合约未经过独立第三方审计                                           | 只能维持 0.003 WETH 工程金丝雀，不能扩大本金        |
| P1     | 历史 replay、reorg/gap recovery、provider chaos tests 未实现           | 通用系统的长时间稳定性与故障恢复尚未证明            |
| P2     | GitHub 仓库和云端 Actions 尚未创建/运行                                | CI 仅为配置与本地验证，不能声称远端门禁生效         |
| P2     | 生产采用手动固定提交发布，尚无自动 CD                                  | 发布需逐次核对提交、链上地址、服务 PID 与 heartbeat |

## Sniper heuristic audit 解读

仓库静态审计已运行，外部规格 validator 为 `VALID`。启发式扫描仍未把当前 typed executor 识别为 action shape，并会扫描本地忽略的 fork cache 及通用 package 键；这些结果只能作为人工复核线索，不能代替合约、分叉、主网回执和运行时读回，也不会为了消除启发式提示而加入无意义调用点。

## 本次最小上线计划

1. 固定并公开当前提交，等待 GitHub Actions 真实通过；
2. 以该提交创建独立服务器 release，保留现有策略服务；
3. 用专用地址在 Base 部署并注入 0.003 WETH，保存主网回执并读回 bytecode/配置；
4. 单独发送 arm 交易，读回 `armed=true` 后才创建 `LIVE_APPROVED` 并启动 systemd；
5. 从链上、systemd、heartbeat 和账本四处复核；没有 `RECONCILED_SUCCESS` 时明确报告净利润为零；
6. 通用 Phase 1B 与新增协议继续 shadow，不因窄金丝雀上线而跳过 typed adapter 与证据门槛。
