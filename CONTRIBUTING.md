# Contributing

1. 不提交钱包、密钥、助记词、Webhook、付费 RPC 凭据或原始签名交易。
2. 新协议必须按 registry → discovery → state → quote → risk → calldata → effect 分级，不得一次性宣称全栈支持。
3. 业务语义变化需要故事卡、测试和 ADR；证据级别不得静默升级。
4. 提交前运行：

```bash
npm ci
npm run check
npm audit --audit-level=low
```

5. Phase 0/1/2 的 PR 不得添加 signer 或 transaction broadcast；任何实盘阶段需要新的 ADR、资金授权与独立安全审计。
