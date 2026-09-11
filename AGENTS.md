# AGENTS.md — 指令规范与知识路由

本文件是仓库根级指令权威。所有在本仓库工作的 Agent 必须严格遵守下列规则与路由约定。

## 1. 仓库定位与工作红线

- **当前阶段**：DSH 开源插件工程实现与真实验证阶段（Active Plugin Implementation）。
- **质量红线**：所有单元测试必须保持 100% 通过（`npm test`）；真实大模型 E2E 验证脚本保持可用（`npm run test:e2e`）。
- **信息保护红线**：严禁将个人信息、真实 API 凭据、私钥或绝对路径硬编码提交至 Git 版本控制。密钥统一通过 `.env` 环境变量注入。
- **架构不变式红线**：严禁在工具内部直接触发表面折叠；必须严格保护 Node 0（系统提示）；折叠后必须完整携带有效便签。

## 2. 知识路由地图（两跳内可达）

- [系统架构与核心设计](docs/design.md)：包含核心能力定义、三大不变式、并发调度约束与防总结降级设计。
- [DSH 核心接口机制对账](docs/dsh-integration.md)：包含 `CompactionEngine` 扩展、会话表面折叠 `surfaceOp`、Node 0 保护、工具执行调度屏障、持久化回放以及 TokenMeter 联动。
- [验收矩阵与后续演进](docs/validation.md)：包含分级架构裁剪决策表、覆盖单元/集成/回放/门禁的验收测试矩阵，以及下一阶段切片执行指南。
- [中文文档说明](README.md)：包含中文设计背景、架构图谱与使用说明。
- [英文文档说明](README_EN.md)：包含英文章程、快速开始、API 参考与测试指引。

## 3. 变更类型与文档同步映射（Doc-Sync）

| 变更类型 | 对应修改文档 | 约束与核验要求 |
| 滚动状态机、便签生命周期、不变式调整 | `docs/design.md` | 必须保持"无损归档 != 保证召回"原则，显式核对并发安全 |
| DSH 核心接口（Compaction/Surface/Tools）对账更新 | `docs/dsh-integration.md` | 必须标明 DSH 跟踪基线 Commit SHA，未决缝隙不得虚标已解决 |
| 测试验收标准、运行时验收用例更新 | `docs/validation.md` | 验收项必须可执行、可判定；测试覆盖必须保持全绿 |
| 根级指令、工作红线或公共状态变更 | `AGENTS.md` 与 `README.md` | `AGENTS.md` 行数严格保持 ≤ 120 行 |

## 4. 本地反馈与验证命令

本仓库采用零依赖的原生 Node 脚本提供秒级确定性反馈：
- 文档校验：`npm run docs:lint`（或 `node scripts/docs-lint.mjs`）
  - **DL1**：`AGENTS.md` 行数上限检查（严格 ≤ 120 行）；
  - **DL2**：全量 Markdown 相对链接与目标引用有效性检查。
- 单元测试：`npm test`（覆盖状态机、便签、工具互斥、Node 0 保护）
- 真实 E2E 测试：`npm run test:e2e`（驱动真实大模型验证）
- 全量门禁：`npm run check`
