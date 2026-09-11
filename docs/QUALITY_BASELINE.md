# 工程质量基线与未闭环项

更新时间：2026-09-11

## 已满足

| 要求           | 证据                                                 | 当前结论                                                                                  |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 高风险边界测试 | `test/*.test.ts`                                     | 20/20：跨链/重复池、混合状态、成本后利润、只读 RPC、敏感证据、来源归因、事件语义与 gap    |
| 自动化门禁     | `npm run check`                                      | format、lint、typecheck、spec、test、secret scan 串行失败关闭                             |
| 合并前 CI      | `.github/workflows/ci.yml`                           | PR/push 自动运行 `npm ci` 与 `npm run check`；尚未推送，因此云端 Actions 状态为 `NOT_RUN` |
| 文档与设计决策 | `docs/TECH_SPEC.md`、`docs/decisions/0001-*`         | 目标、非目标、边界、晋级条件与取舍已记录                                                  |
| 清晰故事卡     | `docs/STORIES.md`                                    | Phase 0 小故事可独立验收；后续故事不伪装成已实现                                          |
| 统一代码风格   | Prettier + ESLint                                    | 本地门禁已通过                                                                            |
| 依赖安全       | `npm audit --audit-level=low`                        | 0 vulnerabilities                                                                         |
| 外部机制规格   | `spec/sniper-spec.json`                              | Sniper v1.4 validator：VALID，0 error，0 warning                                          |
| 只读链上核验   | `docs/evidence/2026-09-11-phase1a-bounded-census.md` | Base 17/17、Robinhood 7/7 地址有 bytecode；Aerodrome 4 个批准工厂与配置一致               |
| 有界池发现     | 同上                                                 | 两条链各 250 区块、所有配置来源无 gap；Base 25 facts，Robinhood 0 facts                   |

## 缺口、影响与优先级

| 优先级 | 缺口                                                                   | 影响                                                 |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| P0     | Factory/PoolManager 只有有界窗口，持久游标与 gap-free 全历史回填未实现 | 无法证明池全集与长期机会频率                         |
| P0     | v2/v3/v4/Aerodrome live state/quote adapters 未实现                    | 当前只能验证机制和 fixture，不能报告实时可执行利润   |
| P0     | Hook 与非标准 token 风险适配器未实现                                   | 不能安全进入 calldata 或实盘                         |
| P0     | 机会半衰期、竞品胜者和 wire timing 未测量                              | 无法判断公共 RPC 是否够快、付费 RPC 是否值得         |
| P1     | 历史 replay、reorg/gap recovery、provider chaos tests 未实现           | 长时间稳定性与故障恢复未证明                         |
| P1     | 运行服务、健康检查和观察面板未实现                                     | 没有 7×24 在线状态；当前不存在可部署 runtime         |
| P1     | 执行合约、Signer、nonce、broadcast、EffectRecord 全部未实现            | 不能交易；这是当前安全边界，不是遗漏的隐形能力       |
| P2     | GitHub 仓库和云端 Actions 尚未创建/运行                                | CI 仅为配置与本地验证，不能声称远端门禁生效          |
| P2     | CD 未配置                                                              | 当前没有可部署 runtime，配置 CD 会制造虚假“上线”状态 |

## Sniper heuristic audit 解读

仓库静态审计已运行。它将 action shape 判定为 `UNKNOWN`，符合 Phase 0 不含 calldata/sign/broadcast 的设计；其 33 条 warning 全部是 package/tsconfig 通用键未在业务源码中消费的启发式提示，不是运行缺陷。不会为了让启发式报告变绿而加入无意义调用点。

## 最小下一步

下一步只补 Phase 1B：持久游标、全历史分段回填、重组撤销和状态缓存/依赖唤醒。完成可证明池全集的普查后，再实现 P0 live state/exact quote adapters，回答“机会是否真的存在”。付费 RPC 必须有公共 RPC 失败率或延迟造成机会损失的量化证据。生产执行、CD 和钱包保持冻结。
