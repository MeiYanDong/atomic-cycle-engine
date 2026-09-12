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

## 已实现：Phase 1A 有界在线发现

### S1A-01 类型化工厂事件

验收：

- Uniswap v2/v3/v4、Aerodrome Standard/Slipstream 与 PancakeSwap v3 分别使用明确事件 ABI；
- 每条 `PoolFact` 保留链、来源、协议、venue、块高、块哈希、交易哈希和日志索引；
- v4 保留 bytes32 pool identity，不虚构池合约地址；
- Aerodrome 从 FactoryRegistry 读取并核对当前全部批准工厂。

### S1A-02 有界窗口与缺口语义

验收：

- 每个来源独立请求和统计；
- RPC 或解码失败记录精确区块范围并标记 `GAPPED`；
- Base 与 Robinhood Chain 各完成一次 250 区块真实读回；
- 结果明确不外推为全历史覆盖、机会频率或可执行利润。

## 下一阶段：Phase 1B 在线普查

### S1A-03 Robinhood/BNB 独立场所注册与有界发现

验收：

- Robinhood 的 Uniswap v2、PancakeSwap v2/v3 与原有 Uniswap v3/v4 分别形成独立 venue；
- BNB 的 PancakeSwap v2/v3 与 Uniswap v2/v3/v4 使用官方注册地址；
- PancakeSwap v2 不继承 Uniswap v2 的固定手续费假设；
- BNB 公共 RPC 不支持日志时结果必须是 `GAPPED`，不能写成零池；
- 所有新增能力保持只读，`sign/broadcast/calldata` 仍为 unsupported/planned。

### S1A-04 Robinhood/BNB 跨场所同块影子报价

验收：

- Robinhood 与 BNB 分别在一个固定规范块上比较 Uniswap/PancakeSwap V2/V3 的两跳闭环；
- V2 使用各协议 Router 的 `getAmountsOut`，不自行猜测 PancakeSwap V2 手续费；
- V3 先按 Factory/fee tier 核验池身份，再调用对应 QuoterV2；
- 候选必须扣除保守 Gas 和风险储备，并明确区分毛利为正、影子净利为正与可执行；
- 每个资产先跑最小金额；只有毛利为正才扩大第二金额，正常无机会轮次不浪费公共 RPC；
- 公共快照不含 RPC 地址、钱包、Signer 或交易能力，`executableCycles` 恒为零；
- RPC 不完整时显示 `PARTIAL`，不能把缺失报价当成零机会；
- 只允许对 transport 抛错进行一次有界重试，JSON-RPC/EVM 错误不得重试；实际 provider 请求、transport
  失败、成功恢复和最终未解决报价失败必须分别计数；
- 独立 systemd 服务持续刷新，不影响既有 Base/Robinhood 实盘进程与账本。

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

## 已实现：Base V2/V3 自有资金 Canary 能力

### S3-01 原子执行合约

验收：

- 只允许 Base、规范 Uniswap V2/V3 工厂、WETH 起止和明确 token allowlist；
- 链上本金上限、最低毛利、deadline、有效块、重入保护和无中间 token 残余仓位；
- 任意 target/calldata/approve/delegatecall 不存在；
- 确定性合约测试覆盖两个正向方向和关键拒绝边界；Base 主网分叉测试证明两个方向都能走到链上利润门禁；
- 尚未完成独立第三方审计，首轮因此维持 `0.003 WETH` 不可变上限。

### S3-02 单钱包单 nonce owner

验收：持久 fencing 绑定 boot ID、PID 与进程启动标识，重启后 PID 被其他进程复用时不会误认旧 owner；锁释放必须核对 owner token；唯一 nonce owner、计划先落盘、同 raw fanout、规范链 receipt/event/WETH/L1 fee reconcile；单 RPC null 不得被记为收益或安全失败。

### S3-03 生产安全与发布

验收：用户明确批准专用地址、`0.01 ETH`、单笔 `0.003 WETH`、`0.005 ETH` 储备与累计失败 Gas `0.001 ETH`；CI 构建不可变产物；灰度部署、运行时 readback、disarm kill-switch 与 UNKNOWN 恢复有证据。实现完成不等于生产已激活，链上回执和 systemd 读回需单独记录。

## 尚未实现：通用多池实盘

### S4-01 更多协议与 3–4 跳 calldata

验收：每个新增协议有独立 typed state/quote/calldata/risk adapter、真实分叉与 token-semantics 测试；不得把当前 V2/V3 两池合约宣传为任意多池执行器。

### S4-02 事件驱动热路径与竞速归因

验收：按池状态事件唤醒受影响路线，测量 source-to-wire、provider ack 和规范链胜者；公共 RPC 与付费 RPC 的边际捕获率可复算后再扩容。
