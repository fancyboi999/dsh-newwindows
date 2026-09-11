# DSH 核心接口机制对账与集成规范

本文档记录对 DeepSeek Harness (DSH) 核心源码的接口审计结论、已验证能力缝隙与工程集成约束。

---

## 1. 代码审计基线与环境说明

- **跟踪上游基线**：Commit SHA `aa8262ec091698bae9a6b04773a6b5b06ad4aef2`
- **本地审计快照**：Commit SHA `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- **扩展机制属性**：DSH 基于 Cordis IoC 插件体系构建，`dsh-newwindows` 属于 Out-of-tree 社区插件，无需侵入修改 DSH 核心源码。

---

## 2. 核心集成缝隙（Capability Seams）核对

经过对 DSH 源码关键链路的深度审计，确认以下 5 个核心服务缝隙满足扩展要求：

### 2.1 CompactionEngine 抽象服务子类化
- **源码定位**：`packages/compaction/compaction/src/index.ts`（第 80–172 行）
- **服务定义**：
  ```typescript
  export abstract class CompactionEngine extends Service {
    constructor(ctx: Context) { super(ctx, 'compaction') }
    abstract compactIfNeeded(agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null>
    abstract compactNow(agent: ManualCompactAgentContext, signal: AbortSignal, sourceCommandId?: CommandId): Promise<CompactionResult | null>
    abstract compactRegion(start: number, end: number, agent: CompactionAgentContext, signal?: AbortSignal): Promise<CompactionResult>
  }
  ```
- **挂载与替换模式**：
  - 在 `packages/bundle/base/cordis.patch.yml` 中，可通过服务重载配置用 `dsh-newwindows` 替代默认的 `compaction-basic`；
  - 亦可在插件加载时直接覆盖 `ctx.compaction` 服务实例。
- **免总结滚动实现机制**：
  - 默认的 `BasicCompactionEngine`（`packages/compaction/compaction-basic/src/index.ts`）在执行压缩时会调用模型推理流生成总结文本；
  - `dsh-newwindows` 覆写该行为：跳过大模型调用，直接将模型此前保存的最新结构化便签格式化为检查点用户消息（Checkpoint Message），实现零推理成本的表面折叠。

### 2.2 会话表面操作（Surface Replacement）与不变式
- **源码定位**：`packages/core/session/src/surface.ts`（第 35–78、240–345 行）
- **折叠原语**：
  ```typescript
  session.append('user/message', checkpointMessage, {
    surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
    sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
  })
  ```
- **硬性约束规则**：
  1. **Node 0 保护法则（System Head Protection）**：
     - `assertSystemHeadRewrite`（第 245 行）明确要求：表面节点 0 必须受到严格保护；
     - 若节点 0 为 `system/message`，任何替换跨度不得将其静默覆盖，除非替换本身同样是覆盖节点 0 的合法系统头；
     - 因此，上下文滚动的起始位置 `startSeq` 必须严格位于节点 0 之后的第一个非系统节点（符合 `selectCompactableRange` 逻辑）。
  2. **覆盖连续性约束（Contiguity Requirement）**：
     - `sourceEventSeqs` 数组必须严格包含区间内每一个被阴影化（Shadowed）的表面节点序列号（`surface.ts:302`），不可跳跃或遗漏。

### 2.3 工具执行屏障与安全调度（Scheduling Determination）
- **源码定位**：
  - `packages/core/tools/src/index.ts`（第 370–430、1520–1580 行）
  - `packages/core/agent-loop/src/tool-calls.ts`（第 50–280 行）
  - `packages/compaction/compaction/src/pairing.ts`（第 30–90 行）
- **核心接口**：
  ```typescript
  export interface ToolRunContext extends ToolExecution {
    deferContext(context: UserMessage): void
    concludeTurn(): void
  }
  ```
- **关键判定：为什么 `new_context` 严禁在 `execute()` 内就地执行表面折叠？**
  1. **并发与批处理风险**：
     模型可能在一次响应中吐出多个工具调用（如 `[write_note, new_context, grep]`）。`executeToolCalls()` 遍历执行工具组；
  2. **工具成对平衡校验（`toolPairingBalancedAfter`）**：
     DSH 核心规定，执行表面折叠前必须满足 `toolPairingBalancedAfter(session, endSeq)`，即所有已发出的 `tool/call` 必须已经具有对应的 `tool/result`；
  3. **未决调用断裂**：
     在 `new_context.execute()` 运行期间，自身这一步的 `tool/result` 尚未 commit；后续同批工具的调用更未处理完毕。如果在此时触发表面折叠，会导致未提交工具结果与断裂的步骤边界产生冲突，直接抛出不平衡异常！
- **免核心改动的解法**：
  - `new_context` 标记 `executionMode: 'exclusive'`；
  - 工具体内调用 `exec.concludeTurn()` 优雅结束当前 Turn，并通过 `exec.deferContext(...)` 暂存新窗口的种子信息；
  - 真正的表面替换延迟到下一个周期的 `agent/pre-step` 阶段统一安全执行。此时上一 Turn 已经产生 `turn/end`，所有工具结果均已平衡提交。

### 2.4 持久化一致性与重放机制
- **源码定位**：
  - `packages/core/session/src/types.ts`（`SESSION_FORMAT_VERSION = 3`）
  - `packages/core/session/src/index.ts`（`ctx.sessions.flush(session)`）
  - `packages/session/session-persistence/src/index.ts` 与 `src/handle.ts`
- **机制保障**：
  - 所有事件均为只追加日志（Append-only log）；
  - `surfaceOp: { op: 'replace' }` 是标准的持久化事件属性；
  - 系统重启或恢复时，`agentLoop.resume(sessionId)` 逐条重放事件日志，重放逻辑将按完全相同的不变式重新构建表面投影，实现绝对的崩溃恢复一致性；
  - 历史原始日志可通过 `session.snapshotEvents()` 或 `sessionPersistence.open(id, 'read')` 的 `handle.read(offset, length)` 完整且有界地进行切片读取。

### 2.5 计量（TokenMeter）联动
- **源码定位**：`packages/llm/token-meter/src/index.ts`（第 130–220 行）与 `src/surface-fold.ts`
- **联动效果**：
  - `ctx.tokenMeter.measure(session)` 在计算当前上下文 Token 占用时，天然遵循 `surfaceOp: 'replace'` 折叠规则；
  - 一旦表面替换生效，大块历史消息被阴影化，计量器返回的活动 Token 立即缩减至 Node 0 + 种子便签的极小体积，预算预警与超限判定即刻解除。

---

## 3. 开放边界与已知风险声明

在实际编码实现插件前，必须明确以下尚未解决或需要运行时关注的边界：

1. **Turn 边界穿透风险**：
   - DSH 不变式门禁要求 `compaction/start` 与 `compaction/end` 不能跨越 `turn/start` 与 `turn/end`（`compaction/src/invariant.ts:validateTurnBoundary`）；
   - 自动滚动必须严格限定在 Turn 开始阶段的 `agent/pre-step`，手动外部触发必须在 Turn 空闲（Idle）时执行。
2. **KV Cache 前缀失效**：
   - 表面替换在截断历史的同时，不可避免地会使折叠点之后的大模型前缀缓存（Prompt Cache）失效；
   - 插件需保证新窗口初始提示（System Prompt + 种子便签格式）具有高确定性的前缀格式，最大化后续步骤的 Cache 命中率。
3. **未决缝隙状态**：
   - 当前审计仅确认 DSH 现有架构提供了完备的服务替换点与事件原语；
   - 针对多并发会话下的便签本地存储引擎选型与边界截断逻辑，属于待插件工程实现阶段验证的开放点，本仓库在此阶段不宣称已解决。

---

## 4. 文档导航与关联

- 查看系统架构概念与设计不变式：[系统架构与核心设计](design.md)
- 查看测试验收标准与演进切片规划：[验收矩阵与后续演进](validation.md)
