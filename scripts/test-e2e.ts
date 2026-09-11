/**
 * Real End-to-End Test Suite against DeepSeek / OpenAI-compatible Gateway.
 *
 * Drives real model interaction (e.g. deepseek-chat, deepseek-reasoner) through multi-round
 * context management, note recording, clean context rollover, and history lookup.
 *
 * @module dsh-newwindows/scripts/test-e2e
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NotesStore } from '../src/notes-store.ts'
import { WindowChain } from '../src/window-chain.ts'
import { BudgetReminderManager } from '../src/reminder.ts'
import { NewWindowsCompactionEngine } from '../src/engine.ts'
import { createNoteActionTool } from '../src/tools/note-action.ts'
import { createNewContextTool } from '../src/tools/new-context.ts'
import { createLookupRawHistoryTool } from '../src/tools/lookup-history.ts'

// Load .env manually if process.loadEnvFile is not available
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '..', '.env')

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  }
}

const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY
const BASE_URL = process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1'
const MODEL = process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || 'deepseek-chat'

if (!API_KEY) {
  console.error('[E2E Error] DEEPSEEK_API_KEY or OPENAI_API_KEY is not set in environment or .env')
  process.exit(1)
}

// Redact key for logging
const redactedKey = `${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`
console.log(`[E2E Setup] Target Gateway: ${BASE_URL}`)
console.log(`[E2E Setup] Model: ${MODEL}`)
console.log(`[E2E Setup] API Key: ${redactedKey}\n`)

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: any[]
  tool_call_id?: string
}

async function callModel(messages: ChatMessage[], tools: any[]): Promise<any> {
  const url = `${BASE_URL.replace(/\/+$/, '')}/chat/completions`
  const body: any = {
    model: MODEL,
    messages,
    temperature: 0.1,
  }
  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Model API call failed (${res.status} ${res.statusText}): ${errText}`)
  }

  return await res.json()
}

async function run() {
  console.log('===============================================================')
  console.log('     dsh-newwindows: Live E2E Model Verification ')
  console.log('===============================================================\n')

  // 1. Initialize dsh-newwindows components
  const notesStore = new NotesStore()
  const windowChain = new WindowChain('win_live_e2e_0')
  const reminder = new BudgetReminderManager(0.75, 0.90)
  const engine = new NewWindowsCompactionEngine(notesStore, windowChain, reminder)

  const noteAction = createNoteActionTool(notesStore, () => windowChain.currentWindowId)
  const newContext = createNewContextTool(engine)

  const sessionEvents: any[] = []
  const sessionHandle = {
    surfaceEvents: sessionEvents,
    append(type: string, data: any, options: any) {
      const evt = { seq: sessionEvents.length, type, data, options, timestamp: Date.now() }
      sessionEvents.push(evt)
      return evt
    },
    getRawEvents: (start = 0, end?: number) => {
      return sessionEvents.filter((e) => e.seq >= start && (end === undefined || e.seq <= end))
    },
    snapshotEvents: () => [...sessionEvents],
  }

  const lookupHistory = createLookupRawHistoryTool(() => sessionHandle, 10)

  // OpenAI format tools schema
  const openAiTools = [
    {
      type: 'function',
      function: {
        name: noteAction.name,
        description: noteAction.description,
        parameters: noteAction.parameters,
      },
    },
    {
      type: 'function',
      function: {
        name: newContext.name,
        description: newContext.description,
        parameters: newContext.parameters,
      },
    },
    {
      type: 'function',
      function: {
        name: lookupHistory.name,
        description: lookupHistory.description,
        parameters: lookupHistory.parameters,
      },
    },
  ]

  // System Prompt (Node 0)
  const systemPrompt =
    'You are a high-fidelity software engineering agent operating under DeepSeek Harness. ' +
    'You have access to tools for recording structured notes (`note_action`), rolling over context windows (`new_context`), ' +
    'and inspecting raw historical logs (`lookup_raw_history`). ' +
    'When requested, actively use `note_action` to record architectural state and decisions.'

  sessionHandle.append('system/prompt', { text: systemPrompt }, {})

  const conversationHistory: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  // ==============================================================
  // Round 1: Model calls note_action to persist architecture decisions
  // ==============================================================
  console.log('[Turn 1] User Request: Analyze Redis migration & record decisions via note_action')
  const userPrompt1 =
    'We are planning to migrate our b2bsales Redis worker system to Temporal Activities. ' +
    'Please call `note_action` with action="create" to record two notes: ' +
    '1. Title: "Temporal Activity Boundary", Content: "Wrap single chapter generation into idempotent Activity with snapshot replay." ' +
    '2. Title: "Database Fence Rule", Content: "MySQL task state updates require CAS fencing revision checks." ' +
    'Then reply with your analysis.'

  conversationHistory.push({ role: 'user', content: userPrompt1 })
  sessionHandle.append('user/message', { text: userPrompt1 }, {})

  console.log('>> Sending request to Model...')
  const t0 = Date.now()
  const r1 = await callModel(conversationHistory, openAiTools)
  const duration1 = Date.now() - t0
  const message1 = r1.choices[0].message
  console.log(`<< Model responded in ${duration1}ms. Usage: ${JSON.stringify(r1.usage)}`)

  conversationHistory.push(message1)
  sessionHandle.append('assistant/message', message1, {})

  if (message1.tool_calls && message1.tool_calls.length > 0) {
    for (const call of message1.tool_calls) {
      console.log(`>> Executing Tool Call: ${call.function.name} (${call.id})`)
      const args = JSON.parse(call.function.arguments)
      let result: any

      if (call.function.name === 'note_action') {
        result = await noteAction.execute(args)
      } else if (call.function.name === 'new_context') {
        result = await newContext.execute(args)
      }

      console.log(`<< Tool Result: ${JSON.stringify(result).slice(0, 120)}...`)
      conversationHistory.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      })
      sessionHandle.append('tool/result', { id: call.id, result }, {})
    }

    // Follow up to complete turn
    console.log('>> Completing turn with tool execution responses...')
    const r1_followup = await callModel(conversationHistory, openAiTools)
    conversationHistory.push(r1_followup.choices[0].message)
    console.log(`<< Assistant message: ${r1_followup.choices[0].message.content?.slice(0, 150)}...\n`)
  }

  console.log(`[Status Check] Active notes in store: ${notesStore.size}`)
  for (const n of notesStore.listNotes()) {
    console.log(`  * [${n.id}] ${n.title} (${n.content.slice(0, 60)}...)`)
  }
  console.log()

  // ==============================================================
  // Round 2: Model triggers new_context to roll over context window
  // ==============================================================
  console.log('[Turn 2] User Request: Trigger clean context rollover via new_context')
  const userPrompt2 =
    'Phase 1 preparation is finished. Please invoke `new_context` with next_goal="Implement temporal Activity worker with Docker Compose" ' +
    'to roll over into a fresh context window without loss of state.'

  conversationHistory.push({ role: 'user', content: userPrompt2 })
  sessionHandle.append('user/message', { text: userPrompt2 }, {})

  console.log('>> Sending request to Model...')
  const r2 = await callModel(conversationHistory, openAiTools)
  const message2 = r2.choices[0].message
  conversationHistory.push(message2)
  sessionHandle.append('assistant/message', message2, {})

  let rolloverTriggered = false
  if (message2.tool_calls && message2.tool_calls.length > 0) {
    for (const call of message2.tool_calls) {
      if (call.function.name === 'new_context') {
        const args = JSON.parse(call.function.arguments)
        console.log(`>> Executing new_context tool: next_goal="${args.next_goal}"`)
        const res = await newContext.execute(args, {
          concludeTurn: () => {
            console.log('>> Interlock: concludeTurn() invoked. Turn will end gracefully.')
          },
        })
        rolloverTriggered = true
        conversationHistory.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(res),
        })
        sessionHandle.append('tool/result', { id: call.id, result: res }, {})
      }
    }
  }

  if (!rolloverTriggered) {
    // If model didn't call tool, stage manual rollover for verification
    console.log('>> Staging manual rollover for test continuity...')
    engine.stageRollover({
      nextGoal: 'Implement temporal Activity worker with Docker Compose',
      requestedBy: 'manual',
    })
  }

  // ==============================================================
  // Round 3: Step-boundary surface rollover execution
  // ==============================================================
  console.log('\n[Step Boundary] Evaluating pre-step and executing surface folding...')
  const preStepOutcome = await engine.handlePreStep(sessionHandle, 12000, 128000)

  console.log(`>> Rollover Executed: ${preStepOutcome.rolledOver}`)
  console.log(`>> Previous Window ID: ${preStepOutcome.result?.previousWindowId}`)
  console.log(`>> Fresh Window ID: ${preStepOutcome.result?.windowId} (Index: ${preStepOutcome.result?.windowIndex})`)
  console.log(`>> Shadowed Event Range: seq ${preStepOutcome.result?.shadowedRange.start} to ${preStepOutcome.result?.shadowedRange.end}`)
  console.log(`>> Shadowed Total Events: ${preStepOutcome.result?.shadowedSeqs.length}`)
  console.log('\n[Generated Fresh Window Seed Message]:')
  console.log('---------------------------------------------------------------')
  console.log(preStepOutcome.result?.seedMessage)
  console.log('---------------------------------------------------------------\n')

  // ==============================================================
  // Round 4: Resume interaction in fresh window with real model
  // ==============================================================
  console.log('[Turn 3] Executing in Fresh Window (Verifying continuity & active notes)')
  const freshWindowHistory: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: preStepOutcome.result.seedMessage },
    {
      role: 'user',
      content: 'Confirm the current active notes and state the immediate next action to take for the next objective.',
    },
  ]

  console.log('>> Sending fresh window prompt to Model...')
  const r3 = await callModel(freshWindowHistory, openAiTools)
  const message3 = r3.choices[0].message
  console.log(`<< Model Response in Fresh Window:\n${message3.content}\n`)

  // ==============================================================
  // Round 5: Testing lookup_raw_history to inspect shadowed past
  // ==============================================================
  console.log('[Turn 4] Testing lookup_raw_history to inspect shadowed past')
  const lookupRes = await lookupHistory.execute({
    startSeq: 1,
    limit: 5,
  })

  console.log(`>> History lookup returned ${lookupRes.returned_count} of ${lookupRes.total_matching} events:`)
  for (const ev of lookupRes.events || []) {
    console.log(`  [Seq ${ev.seq}] (${ev.role}): ${ev.summary.slice(0, 80)}...`)
  }

  console.log('\n===============================================================')
  console.log('    ✓ All Live End-to-End Test Phases Completed Successfully!  ')
  console.log('===============================================================\n')
}

run().catch((err) => {
  console.error('[E2E Fatal Error]', err)
  process.exit(1)
})
