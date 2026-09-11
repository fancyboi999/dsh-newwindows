/**
 * NewWindowsCompactionEngine
 *
 * Implements summary-free context rollover for DeepSeek Harness.
 * Extends/implements the DSH CompactionEngine contract while eliminating
 * LLM summarization latency, cost, and hallucination.
 *
 * @module dsh-newwindows/engine
 */

import { randomUUID } from 'node:crypto'
import type { NotesStore } from './notes-store.ts'
import type { WindowChain } from './window-chain.ts'
import type { BudgetReminderManager } from './reminder.ts'
import { formatNewWindowSeedMessage, validateFoldingRange } from './surface.ts'
import type { NewWindowsConfig, ResolvedNewWindowsConfig, StagedRollover } from './types.ts'

export interface SessionSurfaceNode {
  seq: number
  type: string
  content?: any
}

export interface SessionHandleLike {
  id?: string
  surface?: {
    nodes?: SessionSurfaceNode[]
    replaceGeneration?: number
  }
  append?(type: string, data: any, options?: any): any
  getRawEvents?(startSeq?: number, endSeq?: number): any[]
  snapshotEvents?(): any[]
}

export interface AgentContextLike {
  session: SessionHandleLike
  status?: string
}

export class NewWindowsCompactionEngine {
  readonly notesStore: NotesStore
  readonly windowChain: WindowChain
  readonly reminderManager: BudgetReminderManager
  readonly config: ResolvedNewWindowsConfig
  private stagedRollover: StagedRollover | null = null

  constructor(
    notesStore: NotesStore,
    windowChain: WindowChain,
    reminderManager: BudgetReminderManager,
    config: NewWindowsConfig = {},
  ) {
    this.notesStore = notesStore
    this.windowChain = windowChain
    this.reminderManager = reminderManager
    this.config = {
      auto: config.auto ?? true,
      reminderThresholdRatio: config.reminderThresholdRatio ?? 0.75,
      overflowThresholdRatio: config.overflowThresholdRatio ?? 0.90,
      maxNotes: config.maxNotes ?? 30,
      maxNoteChars: config.maxNoteChars ?? 4000,
      maxHistoryEvents: config.maxHistoryEvents ?? 15,
    }
  }

  /**
   * Stage a rollover request from a tool call or supervisor signal.
   * Does NOT fold immediately to preserve tool-pairing invariants.
   */
  stageRollover(intent: {
    nextGoal: string
    requestedBy: 'tool' | 'auto_overflow' | 'manual'
  }): void {
    this.stagedRollover = {
      ...intent,
      timestamp: Date.now(),
    }
  }

  /**
   * Check whether a rollover is currently staged.
   */
  hasStagedRollover(): boolean {
    return this.stagedRollover !== null
  }

  /**
   * Get the currently staged rollover intent.
   */
  getStagedRollover(): StagedRollover | null {
    return this.stagedRollover
  }

  /**
   * Clear the staged rollover intent.
   */
  clearStagedRollover(): void {
    this.stagedRollover = null
  }

  /**
   * Evaluate pre-step conditions: reminder issuance and rollover execution.
   */
  async handlePreStep(
    session: SessionHandleLike,
    currentTokens: number,
    contextLimit: number,
    signal?: AbortSignal,
  ): Promise<{ reminder?: string; rolledOver: boolean; result?: any }> {
    if (signal?.aborted) {
      throw new Error('Pre-step evaluation aborted.')
    }

    const currentWindowId = this.windowChain.currentWindowId

    // 1. If an explicit rollover is staged (e.g. from new_context tool call), execute it now!
    if (this.stagedRollover) {
      const intent = this.stagedRollover
      this.stagedRollover = null
      const result = await this.executeRollover(session, intent.nextGoal, intent.requestedBy)
      return { rolledOver: true, result }
    }

    if (!this.config.auto || contextLimit <= 0) {
      return { rolledOver: false }
    }

    // 2. Check for automatic hard overflow
    if (this.reminderManager.isOverflow(currentTokens, contextLimit)) {
      const result = await this.executeRollover(
        session,
        'Context limit reached. Resume primary task using active notes.',
        'auto_overflow',
      )
      return { rolledOver: true, result }
    }

    // 3. Check for single-shot reminder threshold
    if (this.reminderManager.shouldRemind(currentWindowId, currentTokens, contextLimit)) {
      this.reminderManager.markReminded(currentWindowId)
      const reminder = this.reminderManager.formatReminderMessage(currentTokens, contextLimit)
      return { reminder, rolledOver: false }
    }

    return { rolledOver: false }
  }

  /**
   * Execute the summary-free context rollover on the given session surface.
   */
  async executeRollover(
    session: SessionHandleLike,
    nextGoal: string,
    requestedBy: 'tool' | 'auto_overflow' | 'manual' = 'manual',
  ): Promise<any> {
    const rawEvents = typeof session.getRawEvents === 'function'
      ? session.getRawEvents()
      : typeof session.snapshotEvents === 'function'
        ? session.snapshotEvents()
        : session.surface?.nodes || []

    const totalEvents = rawEvents.length

    // Protect Node 0: start folding at index 1 (or seq > 0)
    const startSeq = 1
    const endSeq = Math.max(1, totalEvents > 0 ? totalEvents - 1 : 1)

    if (totalEvents > 1) {
      validateFoldingRange(startSeq, endSeq, totalEvents)
    }

    // Advance window chain to generate new Window ID
    const newWindowInfo = this.windowChain.advance()

    // Format active notes for seeding context
    const formattedNotes = this.notesStore.formatNotesForSeed()

    // Build replacement user message
    const seedMessage = formatNewWindowSeedMessage(
      newWindowInfo,
      formattedNotes,
      nextGoal,
    )

    const compactionId = `cmp_${randomUUID()}`
    const shadowedSeqs: number[] = []
    for (let i = startSeq; i <= endSeq; i++) {
      shadowedSeqs.push(i)
    }

    // Apply surface replacement to session if available
    let appendedEvent: any = null
    if (typeof session.append === 'function') {
      appendedEvent = session.append(
        'user/message',
        {
          text: seedMessage,
          content: [{ type: 'text', text: seedMessage }],
        },
        {
          surfaceOp: {
            op: 'replace',
            startSeq,
            endSeq,
          },
          sourceEventSeqs: shadowedSeqs,
          newWindowsMeta: {
            windowId: newWindowInfo.currentWindowId,
            windowIndex: newWindowInfo.currentWindowIndex,
            previousWindowId: newWindowInfo.previousWindowId,
            requestedBy,
          },
        },
      )
    }

    return {
      compactionId,
      windowId: newWindowInfo.currentWindowId,
      windowIndex: newWindowInfo.currentWindowIndex,
      previousWindowId: newWindowInfo.previousWindowId,
      requestedBy,
      shadowedRange: { start: startSeq, end: endSeq },
      shadowedSeqs,
      seedMessage,
      appendedEvent,
    }
  }

  /**
   * Manual trigger (e.g. for /compact command or tests).
   */
  async compactNow(
    session: SessionHandleLike,
    nextGoal = 'Manual rollover requested',
  ): Promise<any> {
    return this.executeRollover(session, nextGoal, 'manual')
  }
}
