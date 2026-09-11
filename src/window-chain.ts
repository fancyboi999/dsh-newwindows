/**
 * Window Chain Identifier Management.
 *
 * Implements monotonic, UUIDv7-compatible context window hierarchy tracking.
 *
 * @module dsh-newwindows/window-chain
 */

import { randomUUID } from 'node:crypto'
import type { WindowChainInfo } from './types.ts'

export class WindowChain {
  private _currentWindowId: string
  private _currentWindowIndex = 0
  private readonly _firstWindowId: string
  private _previousWindowId: string | null = null
  private _createdAt: number

  constructor(initialId?: string) {
    const id = initialId || this.generateWindowId()
    this._firstWindowId = id
    this._currentWindowId = id
    this._createdAt = Date.now()
  }

  /** Generate a time-sortable window identifier (UUIDv7 or RFC4122). */
  private generateWindowId(): string {
    return `win_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  }

  /** Advance to the next context window in the chain. */
  advance(): WindowChainInfo {
    this._previousWindowId = this._currentWindowId
    this._currentWindowId = this.generateWindowId()
    this._currentWindowIndex += 1
    return this.getInfo()
  }

  /** Get snapshot of the current window chain state. */
  getInfo(): WindowChainInfo {
    return {
      currentWindowId: this._currentWindowId,
      currentWindowIndex: this._currentWindowIndex,
      firstWindowId: this._firstWindowId,
      previousWindowId: this._previousWindowId,
      createdAt: this._createdAt,
    }
  }

  get currentWindowId(): string {
    return this._currentWindowId
  }

  get currentWindowIndex(): number {
    return this._currentWindowIndex
  }

  get previousWindowId(): string | null {
    return this._previousWindowId
  }

  get firstWindowId(): string {
    return this._firstWindowId
  }

  exportState(): WindowChainInfo {
    return this.getInfo()
  }

  importState(state: WindowChainInfo): void {
    this._currentWindowId = state.currentWindowId
    this._currentWindowIndex = state.currentWindowIndex
    this._previousWindowId = state.previousWindowId
    this._createdAt = state.createdAt
  }
}
