import test from 'node:test'
import assert from 'node:assert'
import { NotesStore, NotesStoreError } from '../src/notes-store.ts'

test('NotesStore: basic CRUD operations', () => {
  const store = new NotesStore(10, 500)
  assert.strictEqual(store.size, 0)

  // 1. Create
  const note = store.createNote(
    {
      title: 'Database Schema Migration',
      content: 'Migrate users table to include tenant_id with default null.',
      tags: ['db', 'schema'],
    },
    'win_1',
  )

  assert.strictEqual(note.id, 'note-1')
  assert.strictEqual(note.title, 'Database Schema Migration')
  assert.strictEqual(note.author, 'model')
  assert.strictEqual(note.windowId, 'win_1')
  assert.strictEqual(store.size, 1)

  // 2. Get
  const retrieved = store.getNote('note-1')
  assert.ok(retrieved)
  assert.strictEqual(retrieved.id, 'note-1')

  // 3. Update
  const updated = store.updateNote('note-1', {
    content: 'Migrate users table to include tenant_id and revision column.',
    tags: ['db', 'schema', 'fencing'],
  })
  assert.strictEqual(updated.content, 'Migrate users table to include tenant_id and revision column.')
  assert.deepStrictEqual(updated.tags, ['db', 'schema', 'fencing'])

  // 4. Delete
  const deleted = store.deleteNote('note-1')
  assert.strictEqual(deleted, true)
  assert.strictEqual(store.size, 0)
  assert.strictEqual(store.getNote('note-1'), undefined)
})

test('NotesStore: enforce maxNotes limit', () => {
  const store = new NotesStore(2, 500)
  store.createNote({ title: 'Note 1', content: 'C1' }, 'win_1')
  store.createNote({ title: 'Note 2', content: 'C2' }, 'win_1')

  assert.throws(
    () => {
      store.createNote({ title: 'Note 3', content: 'C3' }, 'win_1')
    },
    (err: any) => err instanceof NotesStoreError && err.message.includes('reached maximum notes limit'),
  )
})

test('NotesStore: enforce maxNoteChars limit', () => {
  const store = new NotesStore(10, 20)
  assert.throws(
    () => {
      store.createNote({ title: 'Too long', content: '123456789012345678901' }, 'win_1')
    },
    (err: any) => err instanceof NotesStoreError && err.message.includes('exceeds maximum character limit'),
  )
})

test('NotesStore: search and filter by tags', () => {
  const store = new NotesStore(10, 500)
  store.createNote({ title: 'Redis Lock', content: 'Use Redlock algorithm', tags: ['redis', 'infra'] }, 'win_1')
  store.createNote({ title: 'Temporal Workflow', content: 'Use Activities for IO', tags: ['temporal', 'infra'] }, 'win_1')
  store.createNote({ title: 'React Frontend', content: 'Use Tailwind CSS', tags: ['frontend'] }, 'win_1')

  // Filter by tag
  const infraNotes = store.listNotes({ tag: 'infra' })
  assert.strictEqual(infraNotes.length, 2)

  // Fulltext search
  const temporalSearchResults = store.searchNotes('workflow')
  assert.strictEqual(temporalSearchResults.length, 1)
  assert.strictEqual(temporalSearchResults[0].title, 'Temporal Workflow')
})

test('NotesStore: format notes for window seed', () => {
  const store = new NotesStore(10, 500)
  store.createNote({ title: 'Goal 1', content: 'Deploy Temporal worker', tags: ['goal'] }, 'win_1')
  store.createNote({ title: 'Invariant', content: 'Never write to dev DB', tags: ['security'] }, 'win_1')

  const formatted = store.formatNotesForSeed()
  assert.ok(formatted.includes('Goal 1'))
  assert.ok(formatted.includes('Deploy Temporal worker'))
  assert.ok(formatted.includes('Never write to dev DB'))
})

test('NotesStore: export and restore state', () => {
  const store1 = new NotesStore(10, 500)
  store1.createNote({ title: 'Persistent Decision', content: 'Keep SQLite for tests' }, 'win_1')

  const exported = store1.exportState()

  const store2 = new NotesStore(10, 500)
  store2.importState(exported)

  assert.strictEqual(store2.size, 1)
  const n = store2.getNote('note-1')
  assert.ok(n)
  assert.strictEqual(n.title, 'Persistent Decision')
  assert.strictEqual(n.content, 'Keep SQLite for tests')
})
