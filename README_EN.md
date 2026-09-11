# dsh-newwindows

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-Cordis--Plugin-orange.svg)](https://github.com/deepseek-ai)

[English](README_EN.md) | [中文说明](README.md)

**dsh-newwindows** is an open-source DeepSeek Harness (DSH) extension plugin implementing **summary-free context window rollover**, **model-authored notes**, and **scoped raw history lookup**, inspired by the context management architecture of modern OpenAI Codex.

---

## 1. Motivation: Beyond Lossy LLM Summarization

In long-running, multi-step coding agent sessions, traditional context compaction relies on invoking an LLM to generate recursive text summaries (`compaction-basic`). This legacy approach introduces severe production bottlenecks:

| Dimension | Legacy Summarization Compaction | `dsh-newwindows` Rollover |
|---|---|---|
| **API Cost & Latency** | Consumes hundreds of output tokens and blocks for 5–20 seconds | **Zero LLM tokens**, sub-millisecond local surface folding |
| **Information Fidelity** | High risk of hallucination and loss of file paths, identifiers, or error messages | **Zero loss of crucial state** via structured notes; raw log remains 100% immutable |
| **KV Cache Retention** | Rewritten history breaks prompt prefix cache on the provider | **Maintains clean prefixes** across discrete window boundaries |
| **Window Tracking** | Single linear thread with ambiguous history | **Independently numbered window chain** (`UUIDv7` monotonic progression) |
| **Historical Recall** | Shadowed messages are lost to model attention | **Scoped raw history lookup** on demand without inflating prompt tokens |

---

## 2. Core Capabilities

### 2.1 Model-Authored Notes (`note_action`)
Allows agents to actively record, update, search, and delete structured notes (goals, architectural invariants, state machine flags) during reasoning:
- Session-scoped persistence;
- Strict length and count bounding (`maxNotes`, `maxNoteChars`);
- Automatic formatting as seed context for fresh context windows.

### 2.2 Summary-Free Context Rollover (`new_context`)
Replaces linear history expansion with clean window progression:
- Explicit `new_context` tool with `executionMode: { kind: 'exclusive' }`;
- **Tool-Batch Delay Barrier**: Never folds mid-tool batch! Concludes turn and delays surface folding (`surfaceOp: 'replace'`) until all paired tool results land;
- **Node 0 Protection**: System prompt (Node 0) is permanently preserved; only conversation turns are shadowed.

### 2.3 Scoped Raw History Lookup (`lookup_raw_history`)
Enables agents to query slices of earlier, shadowed conversation windows:
- Strict bounding (`limit` capped, individual events truncated);
- Direct access to immutable append-only event logs;
- Filter by role (`user`, `assistant`, `tool`, `system`).

### 2.4 Single-Shot Budget Reminder
- Emits a single, targeted advisory when context approaches threshold (e.g. 75%);
- **Interlocked**: Emits at most once per window ID, preventing prompt pollution.

---

## 3. Architecture & Safety Invariants

```
+-------------------------------------------------------------------------+
|                              DSH Session                                |
|   +-----------------------------------------------------------------+   |
|   | 1. Model-Authored Notes (NotesStore)                            |   |
|   |    - Structured storage, tagged, bounded, session-isolated      |   |
|   +-----------------------------------------------------------------+   |
|                                    v                                    |
|   +-----------------------------------------------------------------+   |
|   | 2. Step-Boundary Surface Folding (NewWindowsCompactionEngine)   |   |
|   |    - Node 0 Protected (startSeq = 1)                            |   |
|   |    - Tool results paired first (concludeTurn interlock)         |   |
|   |    - surfaceOp: 'replace' seeds new window with active notes    |   |
|   +-----------------------------------------------------------------+   |
|                                    v                                    |
|   +-----------------------------------------------------------------+   |
|   | 3. Bounded History Recall (lookup_raw_history)                  |   |
|   |    - Immutable append-only event replay                         |   |
|   +-----------------------------------------------------------------+   |
+-------------------------------------------------------------------------+
```

---

## 4. Installation & Usage

### 4.1 Via Cordis Configuration (`cordis.patch.yml`)

Add `dsh-newwindows` to your DSH bundle configuration:

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

### 4.2 Programmatic Usage

```typescript
import { Context } from '@deepseek-ai/cordis'
import plugin from 'dsh-newwindows'

const ctx = new Context()

// Mount plugin with custom thresholds
await ctx.plugin(plugin, {
  auto: true,
  reminderThresholdRatio: 0.75,
  overflowThresholdRatio: 0.90,
  maxNotes: 30,
})

// Access service
const { notesStore, windowChain, engine } = ctx.newWindows
```

---

## 5. Testing & Verification

### Unit & Invariant Tests (100% Pass)
Run the native Node.js test suite:
```bash
npm test
```

### Live Model End-to-End Verification
Test with real models (e.g. official DeepSeek API or any OpenAI-compatible gateway):
```bash
# Configure .env
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# Run live verification
npm run test:e2e
```

---

## 6. License & Attribution

- Released under the [Apache-2.0 License](LICENSE).
- Core design patterns inspired by [OpenAI Codex](https://github.com/openai/codex) context compaction and window lifecycle algorithms.
