# dsh-newwindows

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-Cordis--Plugin-orange.svg)](https://github.com/deepseek-ai)

[中文说明](README.md) | [English](README_EN.md)

**dsh-newwindows** 是面向 DeepSeek Harness (DSH/Cordis) 的扩展插件。借鉴最新 OpenAI Codex 运行时的上下文设计，实现了**免总结上下文窗口滚动（Summary-Free Context Rollover）**、**模型自主便签管理（Model-Authored Notes）**与**有界原始历史回溯（Scoped Raw History Lookup）**。

告别昂贵且容易丢失关键细节的递归 LLM 摘要压缩，让 Agent 在长时程任务中实现微秒级上下文接力。

---

## ✨ 核心特性

- ⚡ **零 Token 免总结滚动**：抛弃昂贵的 LLM 递归摘要生成，直接使用 DSH 底层表面折叠重置上下文，实现微秒级窗口重置，避免 5~20 秒的卡顿等待与额外 Token 支出。
- 🛡️ **Node 0 绝对保护**：系统 Prompt 永久常驻，折叠仅作用于历史对话消息（`startSeq = 1`），杜绝 Agent 角色和全局准则丢失。
- 📝 **模型自主便签沉淀**：赋予 Agent 主动记忆能力，在思考中实时记录技术决策与未决事项；新窗口启动时自动作为确定性种子上下文注入。
- 🔒 **并发与工具安全屏障**：`new_context` 工具标记独占执行，通过延迟状态机拦截中途折叠，严格确保同批次所有工具调用配对完成后，在 Step 边界原子生效。
- ⏱️ **单次预算预警闭锁**：上下文占用接近预警阈值时注入单次温和提示，内置状态闭锁防止刷屏污染上下文。
- 🔍 **有界原始历史回溯**：历史物理事件永久保真归档，模型可通过专用只读工具受控检索前序窗口事件，具备严格字符截断与分页保护。

---

## 💡 方案对比

| 评估维度 | 传统 LLM 总结压缩 (`compaction-basic`) | `dsh-newwindows` 免总结窗口滚动 |
| :--- | :--- | :--- |
| **压缩延迟与成本** | 消耗额外上千 Token，卡顿等待 5~20 秒 | **零模型推理开销**，本地微秒级完成上下文重置 |
| **信息保真度** | 频繁丢失代码细节、行号、报错堆栈与精确指令 | **核心决议零损耗**（结构化便签），物理事件全量归档 |
| **Prompt Cache** | 重写前序文本直接打碎服务端 KV Cache 命中 | 离散确定性窗口，保护前缀缓存与语义整洁 |
| **窗口追溯性** | 单一模糊的线性历史 | **显式单调递增窗口链**（UUIDv7 与连续序号跟踪） |
| **历史可访问性** | 被折叠的历史彻底不可见 | 提供有界只读查询工具，支持按需受控回溯 |

---

## 🚀 安装与接入

### 方式 1：通过 Cordis 配置文件挂载 (`cordis.patch.yml`)

在你的 DSH bundle 配置中声明引入插件：

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

### 方式 2：代码编程式加载

```typescript
import { Context } from '@deepseek-ai/cordis'
import plugin from 'dsh-newwindows'

const ctx = new Context()

// 加载插件并自定义配置
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

## ⚙️ 配置选项

插件支持在加载时传入以下可选配置：

| 配置字段 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `auto` | `boolean` | `true` | 是否启用上下文自动监控与超限折叠 |
| `reminderThresholdRatio` | `number` | `0.75` | 预算预警比例（达到 75% 时注入单次整理提示） |
| `overflowThresholdRatio` | `number` | `0.90` | 硬预算熔断比例（达到 90% 时强制触发窗口滚动） |
| `maxNotes` | `number` | `30` | 便签存储条目上限，防止 Agent 便签无限膨胀 |
| `maxNoteChars` | `number` | `4000` | 便签总字符数上限 |
| `seedGoalPrompt` | `string` | `"Continue execution..."` | 滚动到新窗口时默认引导模型继续执行的提示语 |

---

## 🤖 插件贡献的 Agent 工具

加载本插件后，将自动向 DSH Agent 注册以下工具：

### 1. `note_action`
- **定位**：结构化状态暂存器。
- **动作**：`create`（新增便签）、`update`（更新便签）、`delete`（删除过期项）、`list`（列出当前有效便签）。
- **用途**：允许 Agent 主动将关键技术结论、架构决策、待办清单落盘为便签。

### 2. `new_context`
- **定位**：显式窗口滚动触发器。
- **机制**：声明独占执行模式。Agent 主动判定本阶段工作完成或上下文过长时调用，传入 `next_goal` 后优雅结束当前 Turn，安全进入全新时序窗口。

### 3. `lookup_raw_history`
- **定位**：归档事件安全探针。
- **机制**：只读访问已被阴影化的历史物理事件，支持按角色（`user`/`assistant`/`tool`）过滤及分页，单条内容强制截断保护。

---

## 📖 开发与架构细节

- 深入了解系统架构与三大不变式设计：参见 [系统设计规范](docs/design.md)。
- 了解 DSH 底层接口（`CompactionEngine`、`surfaceOp`）对账：参见 [DSH 接口对账](docs/dsh-integration.md)。
- 运行测试套件与参与贡献：参见 [验收与测试矩阵](docs/validation.md)。

---

## 📄 开源协议

本项目基于 [Apache-2.0 协议](LICENSE) 开源。
核心设计理念灵感源自 [OpenAI Codex](https://github.com/openai/codex) 的上下文管理与窗口生命周期架构。
