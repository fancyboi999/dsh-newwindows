/**
 * Tool: new_context
 *
 * Explicit tool allowing the model to trigger a clean context window rollover.
 *
 * Safety Invariants:
 * 1. executionMode = { kind: 'exclusive' } prevents concurrent conflicting tool calls.
 * 2. Never roll over immediately inside tool execute() — stages the rollover intent
 *    and concludes the turn, allowing all tool calls in the batch to complete their
 *    results and pair properly before the surface folds at the step boundary.
 *
 * @module dsh-newwindows/tools/new-context
 */

export interface NewContextArgs {
  next_goal: string
}

export interface RolloverScheduler {
  stageRollover(intent: { nextGoal: string; requestedBy: 'tool' | 'auto_overflow' | 'manual' }): void
}

export interface TurnExecutionControl {
  concludeTurn?(): void
}

export function createNewContextTool(scheduler: RolloverScheduler) {
  return {
    name: 'new_context',
    description:
      'Initiate a clean context window rollover without lossy LLM summarization. ' +
      'All active notes will be carried over into the new window as established background context. ' +
      'Use this when the current task phase is done, or when the context window is getting full.',
    executionMode: { kind: 'exclusive' as const },
    parameters: {
      type: 'object',
      properties: {
        next_goal: {
          type: 'string',
          description: 'The specific next goal, action, or milestone to pursue in the new context window.',
        },
      },
      required: ['next_goal'],
    },
    async execute(args: NewContextArgs, execContext?: TurnExecutionControl) {
      const nextGoal = (args.next_goal || '').trim()
      if (!nextGoal) {
        return {
          error: 'next_goal is required when calling new_context to ensure task continuity.',
        }
      }

      // Stage the rollover request for execution at the step boundary.
      scheduler.stageRollover({
        nextGoal,
        requestedBy: 'tool',
      })

      // Conclude the turn gracefully so remaining batch work finishes and pairs properly.
      if (typeof execContext?.concludeTurn === 'function') {
        execContext.concludeTurn()
      }

      return {
        success: true,
        message:
          'A new context window has been scheduled and will start cleanly at the turn boundary. ' +
          'History will be archived without summarization, and active notes will seed the fresh window.',
        next_goal: nextGoal,
      }
    },
  }
}
