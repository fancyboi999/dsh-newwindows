/**
 * dsh-newwindows: DeepSeek Harness Context Window Management Plugin
 *
 * Implements summary-free context rollover, model-authored notes,
 * and scoped raw history lookup based on modern OpenAI Codex context management.
 *
 * @module dsh-newwindows
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { NotesStore } from './notes-store.ts'
import { WindowChain } from './window-chain.ts'
import { BudgetReminderManager } from './reminder.ts'
import { NewWindowsCompactionEngine } from './engine.ts'
import { createNoteActionTool } from './tools/note-action.ts'
import { createNewContextTool } from './tools/new-context.ts'
import { createLookupRawHistoryTool } from './tools/lookup-history.ts'
import type { NewWindowsConfig, ResolvedNewWindowsConfig } from './types.ts'

export * from './types.ts'
export * from './notes-store.ts'
export * from './window-chain.ts'
export * from './reminder.ts'
export * from './engine.ts'
export * from './surface.ts'
export { createNoteActionTool } from './tools/note-action.ts'
export { createNewContextTool } from './tools/new-context.ts'
export { createLookupRawHistoryTool } from './tools/lookup-history.ts'

export const name = 'dsh-newwindows'

export const Config: z<NewWindowsConfig> = z.object({
  auto: z.boolean().default(true).description('Enable automatic token pressure monitoring and rollover'),
  reminderThresholdRatio: z.number().default(0.75).description('Token ratio to trigger a single-shot reminder'),
  overflowThresholdRatio: z.number().default(0.90).description('Token ratio to force summary-free rollover'),
  maxNotes: z.number().default(30).description('Max active notes stored per session'),
  maxNoteChars: z.number().default(4000).description('Max character length per note'),
  maxHistoryEvents: z.number().default(15).description('Max events returned per raw history lookup query'),
})

export interface NewWindowsServiceContext {
  notesStore: NotesStore
  windowChain: WindowChain
  reminderManager: BudgetReminderManager
  engine: NewWindowsCompactionEngine
  noteActionTool: any
  newContextTool: any
  lookupHistoryTool: any
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    newWindows: NewWindowsServiceContext
  }
}

/**
 * Cordis Plugin entrypoint for DeepSeek Harness.
 */
export function apply(ctx: Context, config: NewWindowsConfig = {}) {
  const notesStore = new NotesStore(config.maxNotes ?? 30, config.maxNoteChars ?? 4000)
  const windowChain = new WindowChain()
  const reminderManager = new BudgetReminderManager(
    config.reminderThresholdRatio ?? 0.75,
    config.overflowThresholdRatio ?? 0.90,
  )
  const engine = new NewWindowsCompactionEngine(
    notesStore,
    windowChain,
    reminderManager,
    config,
  )

  let activeSession: any = null

  // Tools initialization
  const noteActionTool = createNoteActionTool(notesStore, () => windowChain.currentWindowId)
  const newContextTool = createNewContextTool(engine)
  const lookupHistoryTool = createLookupRawHistoryTool(
    () => activeSession,
    config.maxHistoryEvents ?? 15,
  )

  const serviceContext: NewWindowsServiceContext = {
    notesStore,
    windowChain,
    reminderManager,
    engine,
    noteActionTool,
    newContextTool,
    lookupHistoryTool,
  }

  // Register service on Cordis context
  ctx.provide('newWindows')
  ;(ctx as any).newWindows = serviceContext

  // Track active session from events if sessions service is available
  ctx.on('session/event' as any, (session: any) => {
    activeSession = session
  })

  // Hook into agent/pre-step lifecycle if agent service is running
  ctx.on('agent/pre-step' as any, async (args: any, next: any) => {
    const { agent, signal } = args || {}
    if (agent?.session) {
      activeSession = agent.session
      const meter = (ctx as any).get?.('tokenMeter')
      let currentTokens = 0
      let contextLimit = 128000

      if (meter && typeof meter.measure === 'function') {
        const measurement = meter.measure(agent.session)
        currentTokens = measurement.totalTokens || 0
      }

      if (agent.options?.contextWindow) {
        contextLimit = agent.options.contextWindow
      }

      try {
        const { reminder, rolledOver, result } = await engine.handlePreStep(
          agent.session,
          currentTokens,
          contextLimit,
          signal,
        )

        if (reminder && typeof agent.session.append === 'function') {
          agent.session.append('user/message', { text: reminder })
        }

        if (rolledOver) {
          ctx.logger?.info?.(
            `[dsh-newwindows] Context window rolled over cleanly to ${result?.windowId}`,
          )
        }
      } catch (err: any) {
        ctx.logger?.warn?.(`[dsh-newwindows] Pre-step evaluation failed: ${err?.message || err}`)
      }
    }

    if (typeof next === 'function') {
      return next()
    }
  })

  // Expose tools to DSH tools registry if available
  const tools = (ctx as any).get?.('tools')
  if (tools && typeof tools.register === 'function') {
    tools.register(noteActionTool)
    tools.register(newContextTool)
    tools.register(lookupHistoryTool)
  }

  return serviceContext
}

export default {
  name,
  Config,
  apply,
}
