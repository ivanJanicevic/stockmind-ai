import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FunctionCallItem, supportedModels } from '@mozaik-ai/core';

import { preserveGeminiThoughtSignatures } from '../src/gemini-thought-signatures.js';

interface Mapper {
  toResponse(response: unknown): unknown;
  toRequest(input: unknown): { contents: { role: string; parts: Record<string, unknown>[] }[] };
}

function geminiMapper(): Mapper {
  const model = supportedModels.find((m) => m.specification.name === 'gemini-3.5-flash-lite');
  assert.ok(model, 'Mozaik still supports gemini-3.5-flash-lite');
  return (model.endpoint as unknown as { endpointMapper: Mapper }).endpointMapper;
}

// What Mozaik sends back to Gemini when a loop continues after one tool call.
function replay(mapper: Mapper, call: { callId: string; name: string; args: string }) {
  const context = { getItems: () => [FunctionCallItem.rehydrate(call)] };
  const request = mapper.toRequest({ model: 'gemini-3.5-flash-lite', context, tools: [] });
  return request.contents[0]!.parts[0]!;
}

test('the thought signature Gemini returned goes back with the replayed function call', () => {
  preserveGeminiThoughtSignatures();
  const mapper = geminiMapper();

  mapper.toResponse({
    candidates: [
      {
        content: {
          parts: [
            { functionCall: { name: 'read_document', args: { file: 'a.pdf' } }, thoughtSignature: 'sig-123' },
          ],
        },
      },
    ],
  });

  const part = replay(mapper, { callId: '', name: 'read_document', args: '{"file":"a.pdf"}' });
  assert.equal(part.thoughtSignature, 'sig-123');
});

test('a function call with no known signature gets the placeholder Gemini accepts', () => {
  preserveGeminiThoughtSignatures();
  const part = replay(geminiMapper(), { callId: '', name: 'list_documents', args: '{"never":"seen"}' });
  assert.equal(part.thoughtSignature, 'skip_thought_signature_validator');
});
