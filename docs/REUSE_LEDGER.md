# 本地项目复用台账

检索时间：2026-09-11

检索方式：`local-projects/rank_related_projects.py`，完整问题展开，前 20 项逐项处置。

证据级别：除非另注，均为 `repository_record`；不代表当前生产运行状态。

复用策略：只迁移机制和测试思想，不复制密钥、钱包、RPC 凭据、线上地址白名单、live arm、额度或历史交易权限。

| 排名/项目                           | 证据入口                                                                                          | 处置               | 理由与本项目动作                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1 `RH-pons-狙击`                    | `/Users/myandong/Projects/RH-pons-狙击/docs/plan.md`                                              | `reference_only`   | 父仓；其子项目包含竞速规格与生产实现，按子项目分别处理，避免重复计数。                                                  |
| 2 `Web3 Projects Alpha`             | `/Users/myandong/Projects/Web3 Projects Alpha/letscash-keeper/docs/architecture.md`               | `adapt_then_reuse` | 复用 Opportunity→Intent→Plan→Attempt→Effect、UNKNOWN/reconcile 思想；不复用任务特定奖励和钱包。                         |
| 3 `$MM 套利机会`                    | `/Users/myandong/Projects/$MM 套利机会/docs/ARCHITECTURE.md`                                      | `adapt_then_reuse` | 复用冷热路径隔离、状态快照、原子利润下限与本地投影；协议 ABI 和线上配置不复制。                                         |
| 4 `sniper-engineering-v1.5`         | `/Users/myandong/Projects/RH-pons-狙击/sniper-engineering-v1.5/references/first-principles.md`    | `reference_only`   | 旧的版本化快照；当前安装 Skill 是规格校验 source of truth。                                                             |
| 5 `x-api-virtuals-base`             | `/Users/myandong/Documents/Codex/2026-05-20/x-api-virtuals-base/docs/plan.md`                     | `adapt_then_reuse` | 复用多 provider 端口、持久 store 和 reconciler 的接口边界；不复用交易业务。                                             |
| 6 `Robinhood chain`                 | `/Users/myandong/Projects/Robinhood chain/launchpad-dashboard/docs/plan.md`                       | `reference_only`   | 父仓；链普查和来源归因由 `launchpad-dashboard` 子项目提供。                                                             |
| 7 `launchpad-dashboard`             | `/Users/myandong/Projects/Robinhood chain/launchpad-dashboard/services/README.md`                 | `adapt_then_reuse` | 复用 Robinhood 链上普查与平台/协议/venue 分离；不把展示索引当执行真相。                                                 |
| 8 `new-chat-2`                      | `/Users/myandong/Documents/Codex/2026-07-08/new-chat-2/test/adapters.test.ts`                     | `adapt_then_reuse` | 复用 adapter 测试、事件 store 和 provider 隔离模式；不复用 launch-specific 行为。                                       |
| 9 `sniper-engineering`              | `/Users/myandong/Projects/RH-pons-狙击/sniper-engineering/SKILL.md`                               | `reference_only`   | 本地旧副本；用于交叉核对，不覆盖当前安装 Skill。                                                                        |
| 10 `LP`                             | `/Users/myandong/Projects/LP/docs/plan.md`                                                        | `reference_only`   | 只复用经营证据分级和 LP/策略资金隔离；集中流动性 LP 不是原子套利执行器。                                                |
| 11 `batch-launcher`                 | `/Users/myandong/Documents/Codex/2026-07-14/she/batch-launcher/docs/framework-v2.md`              | `adapt_then_reuse` | 复用不可变计划、receipt/recovery 与批次身份；不复用发币动作。                                                           |
| 12 `letscash-keeper-v1-profit-fuse` | `/Users/myandong/Projects/Web3 Projects Alpha/letscash-keeper-v1-profit-fuse/README.md`           | `reference_only`   | 前代/分支快照；由现行 letscash 机制统一处置。                                                                           |
| 13 `letscash-keeper`                | `/Users/myandong/Projects/Web3 Projects Alpha/letscash-keeper/src/services/live-plan-preparer.ts` | `adapt_then_reuse` | 复用计划承诺、利润熔断、provider 分层和回执终态；不复用奖励领取执行。                                                   |
| 14 `atomic-cycle-engine`            | 本仓库                                                                                            | `exclude_self`     | 检索运行时新仓已进入索引，不作为外部复用证据。                                                                          |
| 15 `manga-chan-atomic-arbitrage`    | `/Users/myandong/Projects/manga-chan-atomic-arbitrage/src/source-provenance.mjs`                  | `adapt_then_reuse` | 复用来源正交建模、事件依赖图、同块 quote、金额搜索和 append-only evidence；不复用固定 PAIR 路线、钱包、合约或服务配置。 |
| 16 `tests`                          | `/Users/myandong/Documents/Codex/2026-05-20/x-api-virtuals-base/tests`                            | `same_lineage`     | `x-api-virtuals-base` 的测试子目录，不是独立产品；随排名 5 处理。                                                       |
| 17 `gmgn agent`                     | `/Users/myandong/Projects/gmgn agent/skillmarket-demos/aitrader/README.md`                        | `reference_only`   | 父仓；只参考消费者/路由边界，不把 GMGN 或聚合展示作为链上 truth。                                                       |
| 18 `skillmarket-demos`              | `/Users/myandong/Projects/gmgn agent/skillmarket-demos/cashcat-sentinel/README.md`                | `reference_only`   | 示例集合，不迁移执行逻辑；保留模块隔离与只读监控经验。                                                                  |
| 19 `clockin-sniper`                 | `/Users/myandong/Projects/RH-pons-狙击/clockin-sniper/README.md`                                  | `reference_only`   | 复用信号归因、false-veto 和证据语言；奖励/首块竞速不同于价差套利。                                                      |
| 20 `virtuals-whale-radar`           | `/Users/myandong/Projects/virtuals-whale-radar/docs/PLAN.md`                                      | `adapt_then_reuse` | 复用 provider 预热、能力熔断、适配器和 receipt truth；不复用跟单交易语义。                                              |

## 上一轮同义词检索中出现、此次跌出前 20 的项目

这些项目仍逐项处置，避免排名波动造成遗漏：

| 项目                                                   | 处置               | 说明                                                   |
| ------------------------------------------------------ | ------------------ | ------------------------------------------------------ |
| `/Users/myandong/Projects/批量发币收手续费`            | `reference_only`   | 父仓；只参考历史机会普查和链上反事实，不复用生产钱包。 |
| `/Users/myandong/Projects/批量发币收手续费/shadow`     | `adapt_then_reuse` | 复用 shadow/full-census 和竞品交易归因；策略奖励不同。 |
| `/Users/myandong/Projects/RH-pons-狙击/clockin-sniper` | 已在排名 19        | 同一条目，不重复。                                     |

## 已实际迁移的最小机制

- `SourceProvenance` 四维正交模型；
- 2–4 跳本地依赖图与不重复流动性约束；
- 同一状态承诺的 exact-input quote；
- 机会全集、guard exit、confirmed race loss 与 UNKNOWN 分离；
- 只读 transport 与敏感证据清洗；
- Spec/ADR/story/CI 门禁。

未声明迁移的模块保持 `reference_only` 或 `planned`。本台账不把相似代码、历史测试或旧部署描述成当前可用能力。
