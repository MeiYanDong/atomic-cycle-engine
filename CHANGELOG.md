# Changelog

## Unreleased

- 加入 Base 与 Robinhood Chain 的类型化、有界、gap-aware 工厂事件扫描。
- 从 Aerodrome FactoryRegistry 动态核对 Standard 与三代 Slipstream 工厂。
- 用公共 RPC 完成两条链各 250 区块的只读发现窗口，不把池创建事件误报为套利利润。
- 证据序列化省略未定义可选字段，合约 bytecode 在同一明确块高读取。

## 0.1.0 - 2026-09-11

- 建立独立、shadow-only 的任意资产 2–4 跳同链原子套利核心。
- 加入状态一致性、净收益、机会漏斗、来源归因和只读 RPC 测试。
- 登记并只读核验 Base 与 Robinhood Chain 的首批协议合约。
- 加入 Tech Spec、ADR、故事卡、复用台账、CI 与秘密扫描。
