# 工程质量基线与未闭环项

更新时间：2026-09-13

## 已满足

| 要求             | 证据                                                                   | 当前结论                                                                                                            |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 高风险边界测试   | `test/*.test.ts`、`scripts/base-contract-test.mjs`                     | 62 tests：61 passed、1 个 Linux 专属场景在 macOS 跳过；新增路线簿、池级报价、逐跳择优、分档停止与公开证据断言均通过 |
| 主网分叉测试     | `scripts/base-fork-test.mjs`                                           | 规范 Base WETH/Uniswap V2/V3 双向均走到链上利润门禁，写入仅发生在本地 fork                                          |
| 自动化门禁       | `npm run check`                                                        | format、lint、Solhint、typecheck、spec、compile、test、secret scan 串行失败关闭                                     |
| 合并前 CI        | `.github/workflows/ci.yml`                                             | PR #11 run 34745668071、main run 34745741051 均已成功                                                               |
| 文档与设计决策   | `docs/TECH_SPEC.md`、`docs/decisions/0001-*`、`0002-*`、`0008-*`       | 通用 shadow、受限 Base 实盘例外、Robinhood/BNB 优先级、边界与晋级条件均已记录                                       |
| 清晰故事卡       | `docs/STORIES.md`                                                      | 通用研究、Base 金丝雀与尚未实现的通用多池实盘分别定义并可独立验收                                                   |
| 统一代码风格     | Prettier + ESLint                                                      | 本地门禁已通过                                                                                                      |
| 依赖安全         | `npm audit --audit-level=low`                                          | 0 vulnerabilities；高风险交易运行时仅依赖 `viem`，编译/测试依赖不进入 systemd 热路径                                |
| 外部机制规格     | `spec/sniper-spec.json`                                                | Sniper v1.4 validator：VALID，0 error，0 warning                                                                    |
| 只读链上核验     | `docs/evidence/2026-09-11-phase1a-bounded-census.md`                   | Base 17/17、Robinhood 7/7 地址有 bytecode；Aerodrome 4 个批准工厂与配置一致                                         |
| 有界池发现       | 同上                                                                   | 两条链各 250 区块、所有配置来源无 gap；Base 25 facts，Robinhood 0 facts                                             |
| 实盘安全边界     | `contracts/BaseV2V3CycleExecutor.sol`、ADR 0002                        | 固定链/工厂/WETH、10-token allowlist、0.003 WETH 上限、链上毛利下限、撤防式提款                                     |
| 生产运行定义     | `deploy/systemd/atomic-cycle-live.service`、运行手册                   | 独立用户/目录/凭据、nonce fence、失败熔断、UNKNOWN fail-closed 和运行时读回已定义                                   |
| 生产激活读回     | `docs/evidence/2026-09-13-base-gas-only-live-production.md`            | 新执行器主网部署、0.003 WETH 迁移和 arm 成功；固定利润底线均为 1 wei；systemd active、0 重启；Base 套利收益仍为 0   |
| 扩展发现生产读回 | `docs/evidence/2026-09-13-robinhood-earn-bnb-route-book-production.md` | Robinhood/BNB 生产持续报价、既有实盘恢复、收益归因、无新增广播和 ENOSPC 恢复均有读回证据                            |

## 缺口、影响与优先级

| 优先级 | 缺口                                                                   | 影响                                                |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------- |
| P0     | Robinhood 混合路线与全部 BNB 路线没有 typed atomic executor            | 生产可持续发现，但不能签名、广播或把机会变成成交    |
| P0     | Factory/PoolManager 只有有界窗口，持久游标与 gap-free 全历史回填未实现 | 无法证明通用池全集与长期机会频率                    |
| P0     | v4/Aerodrome 等协议没有 typed live calldata/risk adapter               | 这些来源只能观察，不能安全进入实盘交易              |
| P0     | 机会半衰期、竞品胜者和 wire timing 未测量                              | 无法判断公共 RPC 漏失率或付费 RPC 的边际价值        |
| P1     | 当前合约未经过独立第三方审计                                           | 只能维持 0.003 WETH 工程金丝雀，不能扩大本金        |
| P1     | 历史 replay、reorg/gap recovery、provider chaos tests 未实现           | 通用系统的长时间稳定性与故障恢复尚未证明            |
| P1     | 共享主机尚无 release inode 自动留存策略                                | inode 再次耗尽会阻止实盘状态原子落盘                |
| P2     | 生产采用手动固定提交发布，尚无自动 CD                                  | 发布需逐次核对提交、链上地址、服务 PID 与 heartbeat |

## Sniper heuristic audit 解读

仓库静态审计已运行，外部规格 validator 为 `VALID`。启发式扫描仍未把当前 typed executor 识别为 action shape，并会扫描本地忽略的 fork cache 及通用 package 键；这些结果只能作为人工复核线索，不能代替合约、分叉、主网回执和运行时读回，也不会为了消除启发式提示而加入无意义调用点。

## 本次上线结果

Robinhood/BNB 扩展路线簿已部署到生产持续报价；既有 Robinhood Earn watcher 保持实盘，新增混合路线和 BNB 路线仍为
只读。正毛利候选不会被固定收益额度提前过滤，但仍须通过完整 Gas、风险准备、最新块重报价和链上模拟。不能因为路线已
上线观察就跳过 typed adapter、原子执行与回执对账门槛。当前 Base 没有 `RECONCILED_SUCCESS`，所以 Base 已实现净利润
仍为零。
