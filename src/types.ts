/**
 * Core type definitions for dsh-newwindows.
 *
 * Implements summary-free context rollover, model-authored notes,
 * and scoped raw history lookup inspired by OpenAI Codex context management.
 *
 * @module dsh-newwindows/types
 */

export type NoteAuthor = 'model' | 'user' | 'system'

/** A structured, model-authored or system-injected note. */
export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  author: NoteAuthor
  windowId: string
  createdAt: number
  updatedAt: number
}

/** Input payload for creating a new note. */
export interface CreateNoteInput {
  title: string
  content: string
  tags?: string[]
  author?: NoteAuthor
}

/** Input payload for updating an existing note. */
export interface UpdateNoteInput {
  title?: string
  content?: string
  tags?: string[]
}

/** Information tracking window chain hierarchy. */
export interface WindowChainInfo {
  currentWindowId: string
  currentWindowIndex: number
  firstWindowId: string
  previousWindowId: string | null
  createdAt: number
}

/** Intent describing a pending context window rollover. */
export interface StagedRollover {
  nextGoal: string
  requestedBy: 'tool' | 'auto_overflow' | 'manual'
  timestamp: number
}

/** Runtime configuration for dsh-newwindows. */
export interface NewWindowsConfig {
  /** Whether automatic step-boundary monitoring is enabled. Default true. */
  auto?: boolean
  /** Token ratio (e.g. 0.75) to trigger a single-shot reminder before rollover. */
  reminderThresholdRatio?: number
  /** Token ratio (e.g. 0.90) to force an automatic summary-free rollover. */
  overflowThresholdRatio?: number
  /** Maximum number of active notes per session. Default 30. */
  maxNotes?: number
  /** Maximum character length per note. Default 4000. */
  maxNoteChars?: number
  /** Maximum events returned in a single lookup_raw_history query. Default 15. */
  maxHistoryEvents?: number
}

/** Resolved configuration with deterministic defaults. */
export interface ResolvedNewWindowsConfig {
  auto: boolean
  reminderThresholdRatio: number
  overflowThresholdRatio: number
  maxNotes: number
  maxNoteChars: number
  maxHistoryEvents: number
}

/** Arguments for lookup_raw_history tool. */
export interface LookupHistoryArgs {
  windowId?: string
  startSeq?: number
  endSeq?: number
  limit?: number
  filterRole?: 'user' | 'assistant' | 'tool'
}

/** History slice item returned by lookup_raw_history. */
export interface HistoryEventSummary {
  seq: number
  type: string
  role?: string
  summary: string
  timestamp?: number
}
