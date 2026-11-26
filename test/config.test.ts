import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadConfig,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_APPROVAL_LIMIT_EUR,
} from '../src/config.js';

test('fails when GEMINI_API_KEY is missing', () => {
  assert.throws(() => loadConfig({}), /GEMINI_API_KEY/);
  assert.throws(() => loadConfig({ GEMINI_API_KEY: '  ' }), /GEMINI_API_KEY/);
});

test('uses defaults', () => {
  assert.deepEqual(loadConfig({ GEMINI_API_KEY: 'k' }), {
    models: [DEFAULT_MODEL],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    approvalLimitEur: DEFAULT_APPROVAL_LIMIT_EUR,
  });
});

test('reads overrides', () => {
  assert.deepEqual(
    loadConfig({
      GEMINI_API_KEY: 'k',
      GEMINI_MODEL: 'm',
      GEMINI_FALLBACK_MODELS: ' f1, ,f2 ',
      RUN_TIMEOUT_MS: '5000',
      APPROVAL_LIMIT_EUR: '1000.5',
    }),
    { models: ['m', 'f1', 'f2'], timeoutMs: 5000, approvalLimitEur: 1000.5 }
  );
});

test('rejects invalid approval limit', () => {
  assert.throws(
    () => loadConfig({ GEMINI_API_KEY: 'k', APPROVAL_LIMIT_EUR: '-1' }),
    /APPROVAL_LIMIT_EUR/
  );
});

test('rejects invalid timeout', () => {
  assert.throws(
    () => loadConfig({ GEMINI_API_KEY: 'k', RUN_TIMEOUT_MS: 'abc' }),
    /RUN_TIMEOUT_MS/
  );
  assert.throws(
    () => loadConfig({ GEMINI_API_KEY: 'k', RUN_TIMEOUT_MS: '0' }),
    /RUN_TIMEOUT_MS/
  );
});
