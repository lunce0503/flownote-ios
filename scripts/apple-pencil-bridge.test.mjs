import assert from 'node:assert/strict';
import test from 'node:test';
import { pencilBridgeScript } from '../lib/apple-pencil-bridge.ts';

test('Pencil bridge emits only a fixed custom event and allowlisted preference', () => {
  const script = pencilBridgeScript('switchEraser');
  assert.match(script, /flownote:apple-pencil-double-tap/);
  assert.match(script, /switchEraser/);
  assert.doesNotMatch(script, /eval|location|fetch|postMessage/);
  assert.throws(() => pencilBridgeScript('javascript:alert(1)'));
});
