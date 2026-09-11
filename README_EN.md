# dsh-newwindows

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-Cordis--Plugin-orange.svg)](https://github.com/deepseek-ai)

[中文说明](README.md) | [English](README_EN.md)

**dsh-newwindows** is a performance-oriented extension plugin for DeepSeek Harness (DSH/Cordis). Inspired by the modern OpenAI Codex runtime context architecture, it delivers **Summary-Free Context Rollover**, **Model-Authored Notes**, and **Scoped Raw History Lookup**.

Eliminate sluggish, lossy LLM recursive summarization and empower your agents with microsecond-level, deterministic context relay during long-horizon tasks.

---

## ✨ Key Features

- ⚡ **Zero-Token Summary-Free Rollover**: Bypasses costly recursive LLM summarization. Leverages DSH surface replacement for sub-millisecond context reset, completely eliminating 5~20 second stalls and token billing overhead.
- 🛡️ **Node 0 Absolute Invariant**: Permanent retention of initial system prompts (`startSeq = 1`). Never loses core identity, system rules, or global tool specifications across window transitions.
- 📝 **Model-Authored Notes**: Agents actively curate architectural decisions and pending tasks during reasoning. Active notes are automatically formatted and injected as deterministic seeds into new windows.
- 🔒 **Concurrency & Tool Safety Barrier**: The `new_context` tool declares exclusive execution. Latched state machines postpone compaction until the step boundary, guaranteeing all concurrent tool calls and results pair completely before rollover.
- ⏱️ **Single-Shot Budget Reminder**: Triggers a gentle reminder when approaching budget boundaries (e.g. 75%). State-latched de-duplication prevents context spamming.
- 🔍 **Scoped Raw History Lookup**: Immutable physical logs remain intact. Provides a bounded, read-only inspection tool with strict pagination and per-item character truncation.

---

## 💡 Comparison Matrix

| Evaluation Dimension | Traditional LLM Compaction (`compaction-basic`) | `dsh-newwindows` Rollover |
| :--- | :--- | :--- |
| **Latency & Token Cost** | Consumes 1k~4k tokens, blocks for 5~20 seconds | **Zero inference tokens**, microsecond local surface replacement |
| **Fidelity & Precision** | Hallucination prone; loses exact paths, lines, and errors | **Zero loss on key decisions** via structured notes; raw logs kept intact |
| **Prompt Caching** | Rewriting chat history shatters backend KV cache | Discrete windows preserve deterministic system prefixes |
| **Traceability** | Ambiguous, flattened conversational history | **Monotonic window chain** tracked via UUIDv7 and sequential indexes |
| **History Recyclability** | Summarized history is permanently inaccessible | Dedicated bounded tool enables on-demand retrospective lookup |

---

## 🚀 Installation & Setup

### Option 1: Via Cordis Bundle Patch (`cordis.patch.yml`)

Declare the plugin in your DSH bundle configuration:

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

### Option 2: Programmatic Loading

```typescript
import { Context } from '@deepseek-ai/cordis'
import plugin from 'dsh-newwindows'

const ctx = new Context()

// Load plugin with custom configuration
await ctx.plugin(plugin, {
  auto: true,
  reminderThresholdRatio: 0.75,
  overflowThresholdRatio: 0.90,
  maxNotes: 30,
})

// Access registered services from context
const { notesStore, windowChain, engine } = ctx.newWindows
```

---

## ⚙️ Configuration Options

The plugin accepts the following parameters during initialization:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `auto` | `boolean` | `true` | Automatically track context usage and trigger overflow rollover |
| `reminderThresholdRatio` | `number` | `0.75` | Budget ratio to emit a single-shot reminder to organize notes |
| `overflowThresholdRatio` | `number` | `0.90` | Hard budget ratio to enforce context rollover |
| `maxNotes` | `number` | `30` | Maximum number of notes stored per conversation |
| `maxNoteChars` | `number` | `4000` | Hard ceiling for total note characters |
| `seedGoalPrompt` | `string` | `"Continue execution..."` | Guidance prompt appended with active notes into the fresh window |

---

## 🤖 Contributed Agent Tools

Once activated, `dsh-newwindows` equips the agent with three specialized tools:

### 1. `note_action`
- **Purpose**: Structured state scratchpad.
- **Actions**: `create`, `update`, `delete`, `list`.
- **Use Case**: Allows the agent to persistently retain technical milestones, constraints, and pending todos across window rollovers.

### 2. `new_context`
- **Purpose**: Explicit window rollover trigger.
- **Mechanism**: Declares exclusive execution mode. The agent initiates rollover upon phase completion or high context usage, specifying `next_goal` to cleanly start a fresh window.

### 3. `lookup_raw_history`
- **Purpose**: Safe diagnostic probe over archived interactions.
- **Mechanism**: Provides bounded, read-only pagination over shadowed raw events with optional role filtering (`user`, `assistant`, `tool`).

---

## 📖 Architecture & Developer Documentation

- Core architecture & invariant design: [System Design Spec](docs/design.md)
- DSH internal interface reconciliation: [DSH Integration Guide](docs/dsh-integration.md)
- Test suite & verification matrix: [Validation Matrix](docs/validation.md)

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).
Core mechanisms inspired by the [OpenAI Codex](https://github.com/openai/codex) context management architecture.
