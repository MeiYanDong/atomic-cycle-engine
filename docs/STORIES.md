# 故事卡与验收标准

## 已实现：Phase 0

### S0-01 通用闭环枚举

作为机会引擎，我需要从任意 token-pool 图枚举 2–4 跳闭环，以免策略被 PAIR、股票币或固定 USDG 路径限制。

验收：

- 同链 2、3、4 跳路径均可枚举；
- 不允许重复池、重复中间资产、自环或跨链边；
- 输出排序稳定，输入边 ID 重复时失败。

### S0-02 同状态净收益

作为风险控制，我只接受全部逐跳报价和 Gas 换算来自同一状态承诺的结果。

验收：

- 任一 hop 的状态、输入量或 edge ID 不匹配即失败；
- 净收益扣除 Gas 和显式风险缓冲；
- 金额优选以净利润为目标，同利润优先较小本金。

### S0-03 只读边界

作为资金所有者，我需要 Phase 0 即使配置错误也不能签名或广播。

验收：

- RPC allowlist 不包含账户、签名、发送交易方法；
- 非只读方法在 transport 之前被拒绝；
- 项目不包含钱包、私钥或部署入口；
- 规格中 `sign`、`broadcast` 为 `UNSUPPORTED`。

### S0-04 机会真相漏斗

作为经营者，我需要知道“没有收益”究竟是没有机会、没看到、被门禁拦截、输掉竞速还是状态未知。

验收：

- chainwide candidate 每个恰有一个当前结果；
- `NOT_OBSERVED` 从全集自动得出；
- `UNKNOWN` 和低价值退出不污染竞速胜率；
- 覆盖 gap 会使 watermark 失败关闭。

### S0-05 来源归因

作为产品用户，我需要平台、协议、venue 与发现源清晰分开。

验收：

- 已归因声明必须包含证据引用；
- UNKNOWN 不得附带猜测 ID；
- NINECAT fixture 表达为 `LONG_ROUTE / DOPPLER / UNISWAP_V4`，不是 PAIR。

## 下一阶段：Phase 1 在线普查

### S1-01 Base P0 协议池普查

验收：官方 factory/manager 事件可断点回填；每条记录含块哈希和日志索引；重组可撤销；gap 可定位与回填。

### S1-02 Robinhood 既有普查迁移

验收：迁移只读事件图、游标和来源模型；不迁移钱包、live arm、固定执行形状或生产配置；与现有进程并行不写同一账本。

### S1-03 状态缓存与依赖唤醒

验收：Swap/Sync/ModifyLiquidity 只唤醒受影响路径；热路径无全图轮询；每个 snapshot 有状态承诺和过期规则。

### S1-04 Exact quote adapter

验收：每个 P0 协议有官方 ABI 来源、金丝雀池、正常/空池/极端金额/Hook 风险测试；对照链上 quoter 的误差可解释。

## Phase 2 全量 Shadow

### S2-01 分层金额搜索

验收：粗搜与局部细搜结果可复算；金额上限来自批准本金与路线容量；记录被滑点/Gas 吞没的原因。

### S2-02 反事实竞速

验收：把相同 opportunity identity 与规范链胜者关联；区分确认输竞速、主动不出手和 UNKNOWN；输出延迟分解而非单一“成功率”。

### S2-03 成本与 RPC 价值

验收：按来源记录逻辑请求、实际 provider request、429/超时、单位成本和边际捕获机会；仅在增量净收益证据为正时提出付费扩容。

## Phase 3 自有资金 Canary（未授权）

### S3-01 原子执行合约

验收：typed adapters、链上利润下限、资产守恒、Hook allowlist、reentrancy protection、无残余仓位；独立审计通过。

### S3-02 单钱包单 nonce owner

验收：持久 fencing、唯一 nonce owner、同 raw fanout、规范链 reconcile；单 RPC null 永不终结 UNKNOWN。

### S3-03 生产安全与发布

验收：用户明确批准资金/Gas/部署；CI 构建不可变产物；灰度部署、运行时 readback、kill-switch 与恢复演练有证据。
