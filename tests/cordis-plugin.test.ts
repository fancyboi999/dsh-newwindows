import test from 'node:test'
import assert from 'node:assert'
import { Context } from '@deepseek-ai/cordis'
import plugin, { name, Config } from '../src/index.ts'

test('Cordis Plugin: apply and service registration', async () => {
  const ctx = new Context()

  // Plugin name and Config schema validation
  assert.strictEqual(name, 'dsh-newwindows')
  assert.ok(Config)

  // Apply plugin to Cordis context
  await ctx.plugin(plugin, {
    auto: true,
    reminderThresholdRatio: 0.8,
    overflowThresholdRatio: 0.95,
    maxNotes: 25,
  })

  // Verify service registered on context
  const service = ctx.newWindows
  assert.ok(service)
  assert.ok(service.notesStore)
  assert.ok(service.windowChain)
  assert.ok(service.reminderManager)
  assert.ok(service.engine)
  assert.ok(service.noteActionTool)
  assert.ok(service.newContextTool)
  assert.ok(service.lookupHistoryTool)

  // Verify custom config was applied
  assert.strictEqual(service.engine.config.maxNotes, 25)
  assert.strictEqual(service.engine.config.reminderThresholdRatio, 0.8)
  assert.strictEqual(service.engine.config.overflowThresholdRatio, 0.95)
})
