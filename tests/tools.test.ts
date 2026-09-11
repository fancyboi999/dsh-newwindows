import test from 'node:test'
import assert from 'node:assert'
import { NotesStore } from '../src/notes-store.ts'
import { createNoteActionTool } from '../src/tools/note-action.ts'
import { createNewContextTool } from '../src/tools/new-context.ts'
import { createLookupRawHistoryTool } from '../src/tools/lookup-history.ts'

test('Tool: note_action comprehensive execution', async () => {
  const store = new NotesStore()
  const tool = createNoteActionTool(store, () => 'win_test')

  // Create
  const createRes = await tool.execute({
    action: 'create',
    title: 'Architecture Spec',
    content: 'All state transitions must use CAS version checks.',
    tags: ['arch', 'db'],
  })
  assert.strictEqual(createRes.success, true)
  assert.ok(createRes.note)
  const noteId = createRes.note.id

  // Get
  const getRes = await tool.execute({ action: 'get', id: noteId })
  assert.strictEqual(getRes.success, true)
  assert.strictEqual(getRes.note.title, 'Architecture Spec')

  // Update
  const updateRes = await tool.execute({
    action: 'update',
    id: noteId,
    content: 'All state transitions must use revision numbers and CAS.',
  })
  assert.strictEqual(updateRes.success, true)
  assert.ok(updateRes.note.content.includes('revision numbers'))

  // List
  const listRes = await tool.execute({ action: 'list' })
  assert.strictEqual(listRes.success, true)
  assert.strictEqual(listRes.count, 1)

  // Search
  const searchRes = await tool.execute({ action: 'search', query: 'revision' })
  assert.strictEqual(searchRes.success, true)
  assert.strictEqual(searchRes.count, 1)

  // Delete
  const deleteRes = await tool.execute({ action: 'delete', id: noteId })
  assert.strictEqual(deleteRes.success, true)
  assert.strictEqual(store.size, 0)
})

test('Tool: new_context exclusive mode and concludeTurn interlock', async () => {
  let staged: any = null
  let concluded = false

  const scheduler = {
    stageRollover: (intent: any) => {
      staged = intent
    },
  }

  const tool = createNewContextTool(scheduler)

  // Invariant 1: exclusive executionMode
  assert.deepStrictEqual(tool.executionMode, { kind: 'exclusive' })

  // Validation failure on empty goal
  const errRes = await tool.execute({ next_goal: '   ' })
  assert.ok(errRes.error)
  assert.strictEqual(staged, null)

  // Successful execution
  const successRes = await tool.execute(
    { next_goal: 'Implement database rollback tests' },
    {
      concludeTurn: () => {
        concluded = true
      },
    },
  )

  assert.strictEqual(successRes.success, true)
  assert.ok(successRes.message.includes('scheduled'))
  assert.strictEqual(concluded, true)
  assert.ok(staged)
  assert.strictEqual(staged.nextGoal, 'Implement database rollback tests')
  assert.strictEqual(staged.requestedBy, 'tool')
})

test('Tool: lookup_raw_history bounded pagination and truncation', async () => {
  const mockEvents = [
    { seq: 0, type: 'system/prompt', text: 'You are an agent.' },
    { seq: 1, type: 'user/message', text: 'Please build a compiler.' },
    { seq: 2, type: 'assistant/message', text: 'Sure! Here is the Lexer implementation...' },
    { seq: 3, type: 'tool/call', text: 'exec: cargo build' },
    { seq: 4, type: 'tool/result', text: 'Build succeeded in 0.4s' },
  ]

  const sessionProvider = () => ({
    getRawEvents: (startSeq = 0, endSeq?: number) => {
      return mockEvents.filter((e) => e.seq >= startSeq && (endSeq === undefined || e.seq <= endSeq))
    },
  })

  const tool = createLookupRawHistoryTool(sessionProvider, 5)

  // Query slice
  const res = await tool.execute({
    startSeq: 1,
    limit: 2,
  })

  assert.strictEqual(res.success, true)
  assert.strictEqual(res.total_matching, 4)
  assert.strictEqual(res.returned_count, 2)
  assert.strictEqual(res.events[0].seq, 1)
  assert.strictEqual(res.events[1].seq, 2)

  // Filter by role
  const toolOnlyRes = await tool.execute({
    filterRole: 'tool',
  })
  assert.strictEqual(toolOnlyRes.returned_count, 2)
  assert.strictEqual(toolOnlyRes.events[0].role, 'tool')
})
