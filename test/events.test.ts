import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SituationContext } from '@mozaik-ai/core';

import {
  WhenAnswerFrom,
  WhenAnyAnswer,
  WhenMessageSent,
  answerText,
} from '../src/events.js';

const ctx = (type: string, producerId: string) =>
  ({ event: { type, producerId, payload: {} } }) as unknown as SituationContext;

test('WhenAnswerFrom matches only answers from the given producer', () => {
  const spec = new WhenAnswerFrom('analyst');
  assert.equal(spec.isSatisfiedBy(ctx('model.answer', 'analyst')), true);
  assert.equal(spec.isSatisfiedBy(ctx('model.answer', 'reviewer')), false);
  assert.equal(spec.isSatisfiedBy(ctx('message.sent', 'analyst')), false);
});

test('WhenAnyAnswer matches any model answer', () => {
  const spec = new WhenAnyAnswer();
  assert.equal(spec.isSatisfiedBy(ctx('model.answer', 'x')), true);
  assert.equal(spec.isSatisfiedBy(ctx('message.sent', 'x')), false);
});

test('WhenMessageSent matches only runtime messages', () => {
  const spec = new WhenMessageSent();
  assert.equal(spec.isSatisfiedBy(ctx('message.sent', 'sales')), true);
  assert.equal(spec.isSatisfiedBy(ctx('model.answer', 'sales')), false);
});

test('answerText extracts text from common payload shapes', () => {
  assert.equal(answerText('hi'), 'hi');
  assert.equal(answerText({ text: 'a' }), 'a');
  assert.equal(answerText({ content: 'b' }), 'b');
  assert.equal(answerText({ other: 1 }), JSON.stringify({ other: 1 }, null, 2));
});

test('answerText finds text nested in content parts', () => {
  assert.equal(
    answerText({ role: 'assistant', content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] }),
    '{"a":1}'
  );
  assert.equal(answerText({ message: { content: [{ text: 'x' }] } }), 'x');
  assert.equal(answerText({ output: [{ content: [{ type: 'output_text', text: 'y' }] }] }), 'y');
  assert.equal(answerText({ content: [], text: '' , answer: 'z' }), 'z');
});
