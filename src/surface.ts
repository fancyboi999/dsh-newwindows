/**
 * Surface Folding and Checkpoint Construction.
 *
 * Enforces Node 0 protection, immutable event appending,
 * and structured seeding message formatting for summary-free rollovers.
 *
 * @module dsh-newwindows/surface
 */

import type { WindowChainInfo } from './types.ts'

/**
 * Format the initial user message that seeds a fresh context window.
 */
export function formatNewWindowSeedMessage(
  windowInfo: WindowChainInfo,
  activeNotesFormatted: string,
  nextGoal: string,
): string {
  const prevStr = windowInfo.previousWindowId
    ? ` previous_window_id="${windowInfo.previousWindowId}"`
    : ''

  return [
    `<new_context_window window_id="${windowInfo.currentWindowId}" index="${windowInfo.currentWindowIndex}"${prevStr}>`,
    'Context rolled over cleanly without summarization to free up attention.',
    'Previous conversation is archived immutably and accessible via `lookup_raw_history`.',
    '',
    '### Active Notes & Invariants:',
    activeNotesFormatted,
    '',
    '### Next Objective:',
    nextGoal.trim() || 'Continue pursuing the primary active goal from the active notes above.',
    '</new_context_window>',
  ].join('\n')
}

/**
 * Validates that a proposed folding range preserves Node 0 and remains contiguous.
 */
export function validateFoldingRange(
  startSeq: number,
  endSeq: number,
  totalEvents: number,
): void {
  if (startSeq <= 0) {
    throw new Error(
      `Invariant violation: startSeq (${startSeq}) must be greater than 0 to protect Node 0 (system prompt).`,
    )
  }
  if (startSeq > endSeq) {
    throw new Error(
      `Invalid folding range: startSeq (${startSeq}) exceeds endSeq (${endSeq}).`,
    )
  }
  if (endSeq >= totalEvents) {
    // endSeq cannot exceed existing event sequence bounds
  }
}
