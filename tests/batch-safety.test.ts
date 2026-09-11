import test from 'node:test'
import assert from 'node:assert'
import { NotesStore } from '../src/notes-store.ts'
import { WindowChain } from '../src/window-chain.ts'
import { BudgetReminderManager } from '../src/reminder.ts'
import { NewWindowsCompactionEngine } from '../src/engine.ts'
import { createNoteActionTool } from '../src/tools/note-action.ts'
import { createNewContextTool } from '../src/tools/new-context.ts'

test('TC-02: Tool batch execution safety and delayed rollover barrier', async () => {
  const notesStore = new NotesStore()
  const windowChain = new WindowChain('win_batch_1')
  const reminder = new BudgetReminderManager()
  const engine = new NewWindowsCompactionEngine(notesStore, windowChain, reminder)

  const noteAction = createNoteActionTool(notesStore, () => windowChain.currentWindowId)
  const newContext = createNewContextTool(engine)

  const mockSession = {
    surfaceEvents: [] as any[],
    append(type: string, data: any, options: any) {
      const evt = { seq: this.surfaceEvents.length, type, data, options }
      this.surfaceEvents.push(evt)
      return evt
    },
    snapshotEvents() {
      return [...this.surfaceEvents]
    },
  }

  // Initial events: Node 0 (system prompt) and user message
  mockSession.append('system/prompt', { text: 'You are an agent.' }, {})
  mockSession.append('user/message', { text: 'Perform migration and rollover.' }, {})

  // Simulate LLM calling two tools in a single response turn:
  // Tool 1: note_action (record decision)
  // Tool 2: new_context (stage rollover)

  // 1. Tool 1 executes
  const noteRes = await noteAction.execute({
    action: 'create',
    title: 'Migration Plan',
    content: 'Migrate Redis workers to Temporal Activities.',
  })
  assert.strictEqual(noteRes.success, true)

  // Append tool/call and tool/result to session
  mockSession.append('tool/call', { name: 'note_action', id: 'call_1' }, {})
  mockSession.append('tool/result', { id: 'call_1', result: noteRes }, {})

  // 2. Tool 2 executes
  let turnConcluded = false
  const newContextRes = await newContext.execute(
    { next_goal: 'Run worker recovery integration tests' },
    { concludeTurn: () => { turnConcluded = true } },
  )
  assert.strictEqual(newContextRes.success, true)
  assert.strictEqual(turnConcluded, true)

  // Append tool 2's call and result to session
  mockSession.append('tool/call', { name: 'new_context', id: 'call_2' }, {})
  mockSession.append('tool/result', { id: 'call_2', result: newContextRes }, {})

  // CRITICAL INVARIANT ASSERTION:
  // At this point, ALL tool calls and tool results in the batch have been paired and appended.
  // The surface has NOT yet been folded (no surfaceOp replace event has landed yet).
  assert.strictEqual(engine.hasStagedRollover(), true)
  assert.strictEqual(windowChain.currentWindowIndex, 0)
  assert.strictEqual(mockSession.surfaceEvents.some((e) => e.options?.surfaceOp?.op === 'replace'), false)

  // 3. Now the turn concludes and agent/pre-step evaluates the step boundary:
  const outcome = await engine.handlePreStep(mockSession, 1000, 100000)

  // ASSERTION: Rollover executed safely at the step boundary AFTER all tools paired!
  assert.strictEqual(outcome.rolledOver, true)
  assert.strictEqual(windowChain.currentWindowIndex, 1)

  // The latest event is the replacement user/message with surfaceOp: replace
  const lastEvent = mockSession.surfaceEvents[mockSession.surfaceEvents.length - 1]
  assert.strictEqual(lastEvent.type, 'user/message')
  assert.strictEqual(lastEvent.options.surfaceOp.op, 'replace')
  assert.strictEqual(lastEvent.options.surfaceOp.startSeq, 1) // Node 0 protected
  assert.ok(lastEvent.data.text.includes('Migration Plan'))
  assert.ok(lastEvent.data.text.includes('Run worker recovery integration tests'))
})
