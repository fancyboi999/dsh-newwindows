# dsh-newwindows (中文说明)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-Cordis--Plugin-orange.svg)](https://github.com/deepseek-ai)

[中文说明](README.md) | [English](README_EN.md)

**dsh-newwindows** 是面向 DeepSeek Harness (DSH/Cordis) 的开源扩展插件，实现了**免总结上下文窗口滚动（Summary-Free Context Rollover）**、**模型自主便签管理（Model-Authored Notes）**与**范围受限原始历史回溯（Scoped Raw History Lookup）**，灵感汲取自最新 OpenAI Codex 运行时的上下文管理机制。

---

## 1. 设计初衷：告别损耗严重的 LLM 递归摘要

在长周期、复杂工程任务中，传统的上下文压缩通常依赖大模型对过往历史进行长文本摘要（如 `compaction-basic`）。这种方式在生产实践中存在严重痛点：

| 评估维度 | 传统 LLM 总结压缩 | `dsh-newwindows` 免总结滚动 |
|---|---|---|
| **API 成本与延迟** | 每轮消耗数百至数千生成 Token，阻塞等待 5~20 秒 | **零模型推理 Token**，本地微秒级表面折叠完成重置 |
| **信息保真度** | 容易发生幻觉，丢失代码路径、版本约束与错误细节 | **核心状态零损耗**（通过结构化便签），物理日志永久不可变归档 |
| **前缀缓存 (KV Cache)** | 重写全部历史破坏服务端的 Prompt Prefix 缓存 | 离散窗口保持确定性系统前缀与清晰语义切片 |
| **窗口追踪** | 单一模糊的线性历史 | **独立单调递增窗口链**（`UUIDv7` / 窗口索引显式关联） |
| **历史召回** | 被折叠的历史对模型彻底不可见 | 提供有界只读历史查询工具，按需有界回溯 |

---

## 2. 核心能力

### 2.1 模型自主便签 (`note_action`)
支持智能体在推理思考过程中自主沉淀、更新、检索和管理结构化便签：
- 会话级安全隔离；
- 严格的条目上限与字符数保护（`maxNotes`, `maxNoteChars`）；
- 新窗口启动时，自动将有效便签格式化为种子上下文注入。

### 2.2 免总结上下文滚动 (`new_context`)
优雅替代传统历史累积与强制总结：
- 显式 `new_context` 工具，声明 `executionMode: { kind: 'exclusive' }`；
- **工具批处理延迟屏障（Never Rollover Mid-Tool-Batch）**：绝不在工具内部立即触发折叠！调用 `concludeTurn()` 优雅收尾，确保同批次所有工具结果配对提交后，于 step 边界统一折叠；
- **Node 0 保护**：永久保留初始系统提示（Node 0），仅将历史多轮对话阴影化。

### 2.3 范围受限历史回溯 (`lookup_raw_history`)
为模型提供安全受控的历史回溯接口：
- 严格分页与字符截断保护，防止查询结果二次撑爆上下文；
- 支持按角色过滤（`user`、`assistant`、`tool`、`system`）。

### 2.4 单次预算预警闭锁 (Single-Shot Reminder)
- 在上下文使用率接近预警线（如 75%）时注入单次提示，提醒模型整理便签；
- **状态闭锁**：每个窗口 ID 仅触发一次，杜绝上下文污染。

---

## 3. 系统架构与安全机制

```
+-------------------------------------------------------------------------+
|                              DSH 会话空间                               |
|   +-----------------------------------------------------------------+   |
|   | 1. 模型自主便签 (NotesStore)                                    |   |
|   |    - 结构化存储、标签管理、字符上限保护、单会话隔离             |   |
|   +-----------------------------------------------------------------+   |
|                                    v                                    |
|   +-----------------------------------------------------------------+   |
|   | 2. Step 边界表面折叠 (NewWindowsCompactionEngine)               |   |
|   |    - 严格保护 Node 0 (startSeq = 1)                             |   |
|   |    - 工具结果先配对 (concludeTurn 状态机)                       |   |
|   |    - surfaceOp: 'replace' 注入新窗口种子便签与下一目标          |   |
|   +-----------------------------------------------------------------+   |
|                                    v                                    |
|   +-----------------------------------------------------------------+   |
|   | 3. 有界历史回溯 (lookup_raw_history)                            |   |
|   |    - 只追加不可变物理日志有界切片读取                           |   |
|   +-----------------------------------------------------------------+   |
+-------------------------------------------------------------------------+
```

---

## 4. 安装与接入

### 4.1 通过 Cordis 配置文件 (`cordis.patch.yml`)

在 DSH bundle 配置中声明引入：

```yaml
- insert:
    - id: dsh-newwindows
      name: '@deepseek-ai/cordis-plugin-group'
      group: true
      isolate:
        newWindows: true
      config:
        - id: dsh-newwindows-runtime
          name: 'dsh-newwindows'
```

### 4.2 编程式加载

```typescript
import { Context } from '@deepseek-ai/cordis'
import plugin from 'dsh-newwindows'

const ctx = new Context()

// 加载插件并指定阈值
await ctx.plugin(plugin, {
  auto: true,
  reminderThresholdRatio: 0.75,
  overflowThresholdRatio: 0.90,
  maxNotes: 30,
})

// 从上下文中获取服务实例
const { notesStore, windowChain, engine } = ctx.newWindows
```

---

## 5. 测试与真实验证

### 单元测试与不变量校验（100% 通过）
运行原生 Node.js 测试套件：
```bash
npm test
```

### 真实大模型端到端验证
结合真实大模型（如 DeepSeek 官方 API 或任何兼容 OpenAI 规范的推理网关）验证真实多轮调用闭环：
```bash
# 配置 .env 文件
DEEPSEEK_API_KEY=your_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# 执行真实模型端到端测试
npm run test:e2e
```

---

## 6. 开源协议与致谢

- 本项目采用 [Apache-2.0 协议](LICENSE) 开源。
- 核心设计思路参考自 [OpenAI Codex](https://github.com/openai/codex) 的上下文管理与窗口生命周期架构。
