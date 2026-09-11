/**
 * Tool: lookup_raw_history
 *
 * Scoped, bounded lookup into the immutable event history of the session.
 * Allows retrieving specific details from shadowed earlier context windows
 * on demand, without expanding the active model context.
 *
 * @module dsh-newwindows/tools/lookup-history
 */

import type { HistoryEventSummary, LookupHistoryArgs } from '../types.ts'

export interface SessionHistoryProvider {
  getRawEvents?(startSeq?: number, endSeq?: number): any[]
  snapshotEvents?(): any[]
}

export function createLookupRawHistoryTool(
  sessionProvider: () => SessionHistoryProvider | undefined,
  maxHistoryEvents = 15,
) {
  return {
    name: 'lookup_raw_history',
    description:
      'Inspect historical conversation events and tool calls from earlier context windows. ' +
      'Reads directly from the immutable archive with strict bounded pagination.',
    parameters: {
      type: 'object',
      properties: {
        start_seq: {
          type: 'number',
          description: 'Starting sequence number of the events to inspect (inclusive).',
        },
        end_seq: {
          type: 'number',
          description: 'Ending sequence number of the events to inspect (inclusive).',
        },
        limit: {
          type: 'number',
          description: `Maximum number of events to return (capped at ${maxHistoryEvents}).`,
        },
        filter_role: {
          type: 'string',
          enum: ['user', 'assistant', 'tool'],
          description: 'Optional filter by message role or tool event.',
        },
      },
    },
    async execute(args: LookupHistoryArgs) {
      const provider = sessionProvider()
      if (!provider) {
        return { error: 'Session history provider is not currently attached.' }
      }

      const limit = Math.min(Math.max(args.limit || 5, 1), maxHistoryEvents)
      const startSeq = args.startSeq !== undefined ? args.startSeq : 0
      const endSeq = args.endSeq

      // Fetch raw events from session
      let allEvents: any[] = []
      if (typeof provider.getRawEvents === 'function') {
        allEvents = provider.getRawEvents(startSeq, endSeq)
      } else if (typeof provider.snapshotEvents === 'function') {
        allEvents = provider.snapshotEvents()
      }

      // Filter by sequence bounds
      let filtered = allEvents.filter((ev) => {
        const seq = ev.seq ?? ev.id ?? 0
        if (seq < startSeq) return false
        if (endSeq !== undefined && seq > endSeq) return false
        return true
      })

      // Filter by role if requested
      if (args.filterRole) {
        filtered = filtered.filter((ev) => {
          const role =
            ev.role ||
            (ev.type?.startsWith('user')
              ? 'user'
              : ev.type?.startsWith('assistant')
                ? 'assistant'
                : ev.type?.startsWith('system')
                  ? 'system'
                  : 'tool')
          return role === args.filterRole
        })
      }

      // Slice bounded results
      const totalMatching = filtered.length
      const page = filtered.slice(0, limit)

      const summaries: HistoryEventSummary[] = page.map((ev) => {
        const seq = ev.seq ?? ev.id ?? 0
        const type = ev.type || 'unknown'
        const role =
          ev.role ||
          (type.includes('user')
            ? 'user'
            : type.includes('assistant')
              ? 'assistant'
              : type.includes('system')
                ? 'system'
                : 'tool')
        let text = ''
        if (typeof ev.text === 'string') text = ev.text
        else if (typeof ev.content === 'string') text = ev.content
        else if (Array.isArray(ev.content)) {
          text = ev.content.map((c: any) => c.text || JSON.stringify(c)).join(' ')
        } else if (ev.payload?.text) text = ev.payload.text
        else text = JSON.stringify(ev)

        // Truncate individual event text to 500 characters
        const truncated = text.length > 500 ? text.slice(0, 500) + '... [truncated]' : text

        return {
          seq,
          type,
          role,
          summary: truncated,
          timestamp: ev.timestamp,
        }
      })

      return {
        success: true,
        total_matching: totalMatching,
        returned_count: summaries.length,
        events: summaries,
      }
    },
  }
}
