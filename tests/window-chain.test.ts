import test from 'node:test'
import assert from 'node:assert'
import { WindowChain } from '../src/window-chain.ts'

test('WindowChain: monotonic progression', () => {
  const chain = new WindowChain('win_initial')
  assert.strictEqual(chain.firstWindowId, 'win_initial')
  assert.strictEqual(chain.currentWindowId, 'win_initial')
  assert.strictEqual(chain.currentWindowIndex, 0)
  assert.strictEqual(chain.previousWindowId, null)

  // Advance 1
  const info1 = chain.advance()
  assert.strictEqual(info1.currentWindowIndex, 1)
  assert.strictEqual(info1.previousWindowId, 'win_initial')
  assert.notStrictEqual(info1.currentWindowId, 'win_initial')
  assert.strictEqual(info1.firstWindowId, 'win_initial')

  // Advance 2
  const prevId = info1.currentWindowId
  const info2 = chain.advance()
  assert.strictEqual(info2.currentWindowIndex, 2)
  assert.strictEqual(info2.previousWindowId, prevId)
})

test('WindowChain: state export and import', () => {
  const chain1 = new WindowChain('win_start')
  chain1.advance()
  chain1.advance()

  const exported = chain1.exportState()

  const chain2 = new WindowChain('win_other')
  chain2.importState(exported)

  assert.strictEqual(chain2.currentWindowIndex, 2)
  assert.strictEqual(chain2.currentWindowId, chain1.currentWindowId)
  assert.strictEqual(chain2.previousWindowId, chain1.previousWindowId)
})
