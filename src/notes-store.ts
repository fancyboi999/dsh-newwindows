/**
 * Model-Authored Notes Store.
 *
 * Provides structured, session-isolated note storage for agents
 * to persist key goals, state machines, and invariants across
 * context window boundaries without lossy LLM summarization.
 *
 * @module dsh-newwindows/notes-store
 */

import type { CreateNoteInput, Note, NoteAuthor, UpdateNoteInput } from './types.ts'

export class NotesStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotesStoreError'
  }
}

export class NotesStore {
  private readonly notes = new Map<string, Note>()
  private counter = 0

  private readonly maxNotes: number
  private readonly maxNoteChars: number

  constructor(
    maxNotes = 30,
    maxNoteChars = 4000,
  ) {
    this.maxNotes = maxNotes
    this.maxNoteChars = maxNoteChars
  }

  /**
   * Create a new structured note.
   */
  createNote(input: CreateNoteInput, currentWindowId: string): Note {
    if (this.notes.size >= this.maxNotes) {
      throw new NotesStoreError(
        `Cannot create note: reached maximum notes limit of ${this.maxNotes}. Please update or delete obsolete notes.`,
      )
    }

    const title = (input.title || '').trim()
    if (!title) {
      throw new NotesStoreError('Note title cannot be empty.')
    }

    const content = (input.content || '').trim()
    if (!content) {
      throw new NotesStoreError('Note content cannot be empty.')
    }

    if (content.length > this.maxNoteChars) {
      throw new NotesStoreError(
        `Note content exceeds maximum character limit (${content.length} > ${this.maxNoteChars}).`,
      )
    }

    this.counter += 1
    const id = `note-${this.counter}`
    const now = Date.now()

    const note: Note = {
      id,
      title,
      content,
      tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      author: input.author || 'model',
      windowId: currentWindowId,
      createdAt: now,
      updatedAt: now,
    }

    this.notes.set(id, note)
    return { ...note }
  }

  /**
   * Update an existing note by ID.
   */
  updateNote(id: string, update: UpdateNoteInput): Note {
    const existing = this.notes.get(id)
    if (!existing) {
      throw new NotesStoreError(`Note not found: ${id}`)
    }

    if (update.title !== undefined) {
      const title = update.title.trim()
      if (!title) {
        throw new NotesStoreError('Note title cannot be empty.')
      }
      existing.title = title
    }

    if (update.content !== undefined) {
      const content = update.content.trim()
      if (!content) {
        throw new NotesStoreError('Note content cannot be empty.')
      }
      if (content.length > this.maxNoteChars) {
        throw new NotesStoreError(
          `Note content exceeds maximum character limit (${content.length} > ${this.maxNoteChars}).`,
        )
      }
      existing.content = content
    }

    if (update.tags !== undefined) {
      existing.tags = Array.isArray(update.tags)
        ? update.tags.map((t) => String(t).trim()).filter(Boolean)
        : []
    }

    existing.updatedAt = Date.now()
    this.notes.set(id, existing)
    return { ...existing }
  }

  /**
   * Get a note by ID.
   */
  getNote(id: string): Note | undefined {
    const note = this.notes.get(id)
    return note ? { ...note } : undefined
  }

  /**
   * Delete a note by ID.
   */
  deleteNote(id: string): boolean {
    return this.notes.delete(id)
  }

  /**
   * List all notes with optional filtering and bounding.
   */
  listNotes(options: { tag?: string; limit?: number } = {}): Note[] {
    let result = Array.from(this.notes.values())

    if (options.tag) {
      const tagLower = options.tag.toLowerCase()
      result = result.filter((n) => n.tags.some((t) => t.toLowerCase() === tagLower))
    }

    // Sort by updatedAt descending
    result.sort((a, b) => b.updatedAt - a.updatedAt)

    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit)
    }

    return result.map((n) => ({ ...n }))
  }

  /**
   * Fulltext search over note title, content, and tags.
   */
  searchNotes(query: string, limit = 10): Note[] {
    const q = (query || '').trim().toLowerCase()
    if (!q) return this.listNotes({ limit })

    const matched = Array.from(this.notes.values()).filter((n) => {
      return (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      )
    })

    matched.sort((a, b) => b.updatedAt - a.updatedAt)
    return matched.slice(0, limit).map((n) => ({ ...n }))
  }

  /**
   * Format all active notes into Markdown for seeding a new context window.
   */
  formatNotesForSeed(): string {
    const all = this.listNotes()
    if (all.length === 0) {
      return '(No active notes recorded)'
    }

    return all
      .map((n) => {
        const tagStr = n.tags.length > 0 ? ` [${n.tags.join(', ')}]` : ''
        return `#### [${n.id}] ${n.title}${tagStr}\n${n.content}`
      })
      .join('\n\n')
  }

  /**
   * Export all notes state for serialization / crash recovery.
   */
  exportState(): { counter: number; notes: Note[] } {
    return {
      counter: this.counter,
      notes: Array.from(this.notes.values()).map((n) => ({ ...n })),
    }
  }

  /**
   * Restore notes state.
   */
  importState(state: { counter: number; notes: Note[] }): void {
    this.counter = state.counter || 0
    this.notes.clear()
    for (const n of state.notes || []) {
      this.notes.set(n.id, { ...n })
    }
  }

  /** Current count of notes. */
  get size(): number {
    return this.notes.size
  }
}
