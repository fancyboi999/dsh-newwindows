/**
 * Tool: note_action
 *
 * Allows agents to create, update, retrieve, list, search, and delete
 * structured notes that survive context window rollovers.
 *
 * @module dsh-newwindows/tools/note-action
 */

import type { NotesStore } from '../notes-store.ts'

export interface NoteActionArgs {
  action: 'create' | 'update' | 'get' | 'delete' | 'list' | 'search'
  id?: string
  title?: string
  content?: string
  tags?: string[]
  query?: string
  limit?: number
}

export function createNoteActionTool(notesStore: NotesStore, getWindowId: () => string) {
  return {
    name: 'note_action',
    description:
      'Manage structured notes that persist across context window boundaries. ' +
      'Use this to record active goals, key architectural decisions, and invariants before context rollover.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'get', 'delete', 'list', 'search'],
          description: 'The operation to perform.',
        },
        id: {
          type: 'string',
          description: 'Note ID (e.g. note-1), required for update, get, and delete.',
        },
        title: {
          type: 'string',
          description: 'Title of the note (required for create).',
        },
        content: {
          type: 'string',
          description: 'Content of the note (required for create). Max 4000 characters.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorizing the note.',
        },
        query: {
          type: 'string',
          description: 'Search keyword for searching notes.',
        },
        limit: {
          type: 'number',
          description: 'Max number of notes to return (default 10).',
        },
      },
      required: ['action'],
    },
    async execute(args: NoteActionArgs) {
      const { action } = args

      switch (action) {
        case 'create': {
          if (!args.title || !args.content) {
            return {
              error: 'Missing required parameters: title and content are required for create.',
            }
          }
          const note = notesStore.createNote(
            {
              title: args.title,
              content: args.content,
              tags: args.tags,
              author: 'model',
            },
            getWindowId(),
          )
          return {
            success: true,
            message: `Note ${note.id} created successfully.`,
            note,
          }
        }

        case 'update': {
          if (!args.id) {
            return { error: 'Missing required parameter: id is required for update.' }
          }
          const updated = notesStore.updateNote(args.id, {
            title: args.title,
            content: args.content,
            tags: args.tags,
          })
          return {
            success: true,
            message: `Note ${updated.id} updated successfully.`,
            note: updated,
          }
        }

        case 'get': {
          if (!args.id) {
            return { error: 'Missing required parameter: id is required for get.' }
          }
          const note = notesStore.getNote(args.id)
          if (!note) {
            return { error: `Note with id ${args.id} not found.` }
          }
          return { success: true, note }
        }

        case 'delete': {
          if (!args.id) {
            return { error: 'Missing required parameter: id is required for delete.' }
          }
          const deleted = notesStore.deleteNote(args.id)
          return {
            success: deleted,
            message: deleted ? `Note ${args.id} deleted.` : `Note ${args.id} not found.`,
          }
        }

        case 'list': {
          const notes = notesStore.listNotes({ limit: args.limit || 20 })
          return {
            success: true,
            count: notes.length,
            notes,
          }
        }

        case 'search': {
          if (!args.query) {
            return { error: 'Missing required parameter: query is required for search.' }
          }
          const results = notesStore.searchNotes(args.query, args.limit || 10)
          return {
            success: true,
            count: results.length,
            notes: results,
          }
        }

        default:
          return { error: `Unsupported note action: ${action}` }
      }
    },
  }
}
