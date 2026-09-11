/**
 * Single-Shot Budget Reminder.
 *
 * Emits a single, targeted prompt advisory when token pressure approaches
 * the rollover threshold, encouraging the model to save active notes and
 * trigger a clean new_context before hard overflow.
 *
 * Safety Invariant: Exactly one reminder is emitted per window ID (interlocked).
 *
 * @module dsh-newwindows/reminder
 */

export class BudgetReminderManager {
  private readonly remindedWindows = new Set<string>()

  private readonly reminderThresholdRatio: number
  private readonly overflowThresholdRatio: number

  constructor(
    reminderThresholdRatio = 0.75,
    overflowThresholdRatio = 0.90,
  ) {
    this.reminderThresholdRatio = reminderThresholdRatio
    this.overflowThresholdRatio = overflowThresholdRatio
  }

  /**
   * Evaluates token consumption and determines whether a reminder should be issued.
   */
  shouldRemind(currentWindowId: string, currentTokens: number, contextLimit: number): boolean {
    if (this.remindedWindows.has(currentWindowId)) {
      return false
    }
    if (contextLimit <= 0) return false

    const ratio = currentTokens / contextLimit
    return ratio >= this.reminderThresholdRatio && ratio < this.overflowThresholdRatio
  }

  /**
   * Evaluates if hard overflow threshold is crossed.
   */
  isOverflow(currentTokens: number, contextLimit: number): boolean {
    if (contextLimit <= 0) return false
    return currentTokens / contextLimit >= this.overflowThresholdRatio
  }

  /**
   * Record that a reminder was issued for this window.
   */
  markReminded(currentWindowId: string): void {
    this.remindedWindows.add(currentWindowId)
  }

  /**
   * Generates the structured reminder advisory message.
   */
  formatReminderMessage(currentTokens: number, contextLimit: number): string {
    const percentage = Math.round((currentTokens / contextLimit) * 100)
    return (
      `[System Advisory: Context Window at ${percentage}% (${currentTokens}/${contextLimit} tokens)]\n` +
      'Attention capacity is filling up. Please call `note_action` to record any key findings or pending tasks, ' +
      'then call `new_context` to roll over into a fresh context window without loss of essential state.'
    )
  }

  /**
   * Reset on session reset or window clean up.
   */
  reset(): void {
    this.remindedWindows.clear()
  }
}
