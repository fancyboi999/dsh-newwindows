import test from 'node:test'
import assert from 'node:assert'
import { BudgetReminderManager } from '../src/reminder.ts'

test('BudgetReminderManager: single-shot reminder per window', () => {
  const manager = new BudgetReminderManager(0.75, 0.90)
  const windowId = 'win_test_1'
  const contextLimit = 100000

  // 1. Below threshold (70%) -> should not remind
  assert.strictEqual(manager.shouldRemind(windowId, 70000, contextLimit), false)

  // 2. Crosses threshold (76%) -> should remind
  assert.strictEqual(manager.shouldRemind(windowId, 76000, contextLimit), true)

  // Mark reminded
  manager.markReminded(windowId)

  // 3. Already reminded in this window -> should not remind again (interlock)
  assert.strictEqual(manager.shouldRemind(windowId, 76000, contextLimit), false)
  assert.strictEqual(manager.shouldRemind(windowId, 85000, contextLimit), false)

  // 4. Hard overflow check (91%)
  assert.strictEqual(manager.isOverflow(91000, contextLimit), true)

  // 5. Fresh window id -> can remind again
  const newWindowId = 'win_test_2'
  assert.strictEqual(manager.shouldRemind(newWindowId, 78000, contextLimit), true)
})

test('BudgetReminderManager: format reminder message includes percentage', () => {
  const manager = new BudgetReminderManager()
  const msg = manager.formatReminderMessage(80000, 100000)
  assert.ok(msg.includes('80%'))
  assert.ok(msg.includes('80000/100000'))
  assert.ok(msg.includes('note_action'))
  assert.ok(msg.includes('new_context'))
})
