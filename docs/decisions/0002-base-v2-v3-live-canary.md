# ADR 0002：从通用 Shadow 研究切出有界 Base V2/V3 实盘金丝雀

状态：已接受；生产激活仍以链上资金、部署回执和运行时读回为准

日期：2026-09-11

## 背景

通用 2–4 跳引擎尚未完成所有协议的状态适配、全历史机会分母和竞速样本。用户明确要求不再等待完整 Phase 2 样本，先用低成本自有资金进行实盘验证。这个决定改变了原先“完整 Shadow 证据后才 Canary”的顺序，但没有授权无限本金、强制成交或放松链上利润下限。

## 决策

单独增加一个 Base 主网、WETH 结算、Uniswap V2 与 Uniswap V3 两池闭环的最小实盘切片。它与通用研究核心共仓，但拥有独立执行合约、专用钱包、进程、账本和硬门禁。

首轮范围固定为：

- 专用地址：`0xb756c304B5411B6dC3e7A6CBCD512Fad8eB6Dca7`；密钥只存在生产服务器的 root-only credential 文件；
- 用户向该地址在 Base 转入 `0.01 ETH`，视为接受本 ADR 的首轮金丝雀边界；到账前不得部署或武装；
- 单笔本金上限 `0.003 WETH`，Signer 保留至少 `0.005 ETH`，累计已确认失败 Gas 达 `0.001 ETH` 自动停止新增风险；
- 不设盈利交易次数上限，但每笔必须在签名前通过精确报价、完整合约模拟、L2 Gas、Base L1 data fee、operator fee、净利润和储备金门禁；
- 合约只允许固定 Base chain ID、规范 Uniswap V2/V3 工厂、明确 token allowlist 和 WETH 闭环；没有任意 target、任意 calldata、delegatecall 或任意 approve；
- 交易在链上强制 `gross WETH profit >= minProfit`，中间 token 余额必须回到交易前值。市场变化导致利润消失时整笔回滚，损失仅限 Gas；
- 一次只允许一个 nonce owner；同一签名原文可向多个公共 RPC fanout，但不得针对同一意图重新签名；
- 回执、规范块、Executed 事件、合约 WETH 余额增量、L2 Gas、L1 data fee 与 operator fee 全部对账后才记为收益；`UNKNOWN` 或 `DISPUTED` 立即冻结新增交易。

## 代价与边界

这是一个真实资金的工程金丝雀，不是“稳定盈利”承诺。首轮只覆盖 10 个明确 allowlist 资产的 WETH/V2/V3 两池路线，不能代表通用多池系统已经实盘化，也不能证明机会频率。公共 RPC 限流或延迟会漏掉短机会；在没有量化边际收益前不扩大 ChainStack 用量。

利润留在执行合约的 WETH 余额中。由于单笔本金上限是不可变的 `0.003 WETH`，首轮不会因为累计利润而自动放大单笔风险；扩大上限必须部署新合约并取得新的明确批准。

## 可验证结果

- 本地单元门禁、Solidity 确定性测试和 Base 主网分叉兼容测试必须通过；
- 部署必须产生成功的 Base 主网回执，读回 operator、disarmed、allowlist、不可变上限和 `0.003 WETH` seed；
- arm 必须是第二笔独立交易并读回 `armed=true`；
- systemd 必须读到 credential、LIVE_APPROVED marker 和非敏感环境文件，启动后持续更新中文 heartbeat；
- 同机经营面板只能读取独立的白名单心跳投影，不能读取私钥、尝试账本、错误原文或签名原文；
- 只有出现 `RECONCILED_SUCCESS` EffectRecord，且已扣除 L2 Gas、L1 data fee 与 operator fee，才能声明一笔已实现净利润。
