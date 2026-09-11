import test from 'node:test'
import assert from 'node:assert'
import { NotesStore } from '../src/notes-store.ts'
import { WindowChain } from '../src/window-chain.ts'
import { BudgetReminderManager } from '../src/reminder.ts'
import { NewWindowsCompactionEngine } from '../src/engine.ts'

test('NewWindowsCompactionEngine: Node 0 protection and surface replacement', async () => {
  const notesStore = new NotesStore()
  const windowChain = new WindowChain('win_root')
  const reminder = new BudgetReminderManager()
  const engine = new NewWindowsCompactionEngine(notesStore, windowChain, reminder)

  // Seed a critical note
  notesStore.createNote(
    {
      title: 'Current Mission State',
      content: 'Docker Compose cluster has 5 healthy services.',
      tags: ['state'],
    },
    'win_root',
  )

  let appended: any = null
  const mockSession = {
    surface: {
      nodes: [
        { seq: 0, type: 'system/prompt', text: 'System instruction' },
        { seq: 1, type: 'user/message', text: 'Run the tests' },
        { seq: 2, type: 'assistant/message', text: 'Tests pass' },
      ],
    },
    append: (type: string, data: any, options: any) => {
      appended = { type, data, options }
      return { seq: 3, ...data }
    },
    snapshotEvents: () => [
      { seq: 0, type: 'system/prompt' },
      { seq: 1, type: 'user/message' },
      { seq: 2, type: 'assistant/message' },
    ],
  }

  // 1. Stage a rollover (from new_context tool)
  engine.stageRollover({
    nextGoal: 'Verify temporal disaster recovery under heavy load',
    requestedBy: 'tool',
  })

  // 2. Pre-step evaluates and executes rollover
  const outcome = await engine.handlePreStep(mockSession, 5000, 100000)

  assert.strictEqual(outcome.rolledOver, true)
  assert.ok(outcome.result)

  // Verify Node 0 Protection: folding range starts at 1, NEVER 0
  assert.strictEqual(outcome.result.shadowedRange.start, 1)
  assert.strictEqual(outcome.result.shadowedRange.end, 2)
  assert.deepStrictEqual(outcome.result.shadowedSeqs, [1, 2])

  // Verify surfaceOp was attached
  assert.ok(appended)
  assert.strictEqual(appended.type, 'user/message')
  assert.deepStrictEqual(appended.options.surfaceOp, {
    op: 'replace',
    startSeq: 1,
    endSeq: 2,
  })

  // Verify seed message contains active notes and next goal
  const seedText = appended.data.text
  assert.ok(seedText.includes('win_root'))
  assert.ok(seedText.includes('Docker Compose cluster has 5 healthy services'))
  assert.ok(seedText.includes('Verify temporal disaster recovery under heavy load'))

  // Verify window chain progressed
  assert.strictEqual(windowChain.currentWindowIndex, 1)
  assert.strictEqual(windowChain.previousWindowId, 'win_root')
})

test('NewWindowsCompactionEngine: automatic overflow trigger', async () => {
  const notesStore = new NotesStore()
  const windowChain = new WindowChain('win_start')
  const reminder = new BudgetReminderManager(0.75, 0.90)
  const engine = new NewWindowsCompactionEngine(notesStore, windowChain, reminder)

  const mockSession = {
    snapshotEvents: () => [
      { seq: 0, type: 'system' },
      { seq: 1, type: 'user' },
    ],
    append: (type: string, data: any, options: any) => ({ seq: 2 }),
  }

  // Tokens at 95% of 100,000 limit -> triggers auto rollover
  const outcome = await engine.handlePreStep(mockSession, 95000, 100000)

  assert.strictEqual(outcome.rolledOver, true)
  assert.strictEqual(outcome.result.requestedBy, 'auto_overflow')
  assert.strictEqual(windowChain.currentWindowIndex, 1)
})
