// Runs the Document agent on one PDF with a real model. This calls Gemini and costs credits.
//
//   npm run agent:document -- fakture/faktura-05-kafa.pdf
//
// Prints every tool call the agent makes, its final answer, and the draft that was saved.

import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import { createHuman, defineRuntime, RuntimeState } from '@mozaik-ai/core';

import { loadConfig } from '../../config.js';
import type { DocumentDraft } from '../../domain/document-draft.js';
import { answerText, WhenEventFrom } from '../../events.js';
import { preserveGeminiThoughtSignatures } from '../../gemini-thought-signatures.js';
import { createDocumentAgent, documentTask } from './agent.js';
import { createDocumentTools, type DocumentFile } from './tools.js';

const file = process.argv[2] ?? 'fakture/faktura-05-kafa.pdf';

function fail(message: string): never {
  console.error(`\n[error] ${message}`);
  process.exit(1);
}

function describeError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  return status === undefined ? message : `HTTP ${status}: ${message}`;
}

const config = (() => {
  try {
    return loadConfig(process.env);
  } catch (error) {
    return fail((error as Error).message);
  }
})();

// Shared state of this run: every draft the agent manages to save.
class DocumentState extends RuntimeState {
  drafts: DocumentDraft[] = [];
}

preserveGeminiThoughtSignatures(); // without it Gemini rejects the second call of a tool loop

const state = new DocumentState();
const { initializeRuntime, join, runLoop } = defineRuntime<DocumentState>();
initializeRuntime({ state });

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));
const tools = createDocumentTools({ dataDir, onDraftSaved: (draft) => state.drafts.push(draft) });
const agent = createDocumentAgent(tools);
join(agent);

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const short = (text: string, max = 400) => (text.length > max ? `${text.slice(0, max)}…` : text);

// A participant that only listens: it prints what the agent does and ends the run on its answer.
const console_ = createHuman({
  name: 'Console',
  capabilities: [],
  handlers: [
    {
      specification: new WhenEventFrom(agent.getId(), ['function_call.started']),
      processor: {
        apply({ event }) {
          const call = (event.payload as { call?: { name?: string; args?: string } }).call;
          console.log(`[${elapsed()}] -> ${call?.name}(${short(call?.args ?? '')})`);
        },
      },
    },
    {
      specification: new WhenEventFrom(agent.getId(), ['function_call.completed']),
      processor: {
        apply({ event }) {
          const text = (event.payload as { output?: { text?: string } }).output?.text ?? '';
          // read_document returns the whole document; its first line is enough here.
          console.log(`[${elapsed()}] <- ${short(text.split('\n')[0] ?? '')}`);
        },
      },
    },
    {
      specification: new WhenEventFrom(agent.getId(), ['model.answer']),
      processor: {
        apply({ event }) {
          setImmediate(() => finish(answerText(event.payload)));
        },
      },
    },
  ],
});
join(console_);

function finish(answer: string): void {
  console.log(`\n[${elapsed()}] Document agent answered:\n${answer}\n`);
  if (state.drafts.length === 0) fail('no draft was saved');
  for (const draft of state.drafts) {
    console.log(JSON.stringify(draft, null, 2));
  }
  process.exit(0);
}

process.on('unhandledRejection', (error) => fail(`model call failed: ${describeError(error)}`));
setTimeout(() => fail(`no answer within ${config.timeoutMs / 1000}s`), config.timeoutMs);

// Check the file before spending a model call on it.
const { documents: known } = (await tools.find((t) => t.name === 'list_documents')!.invoke({})) as {
  documents: DocumentFile[];
};
if (!known.some((d) => d.file === file)) {
  fail(`unknown document "${file}". Available:\n${known.map((d) => `  ${d.file}`).join('\n')}`);
}

const model = config.models[0]!;
console.log(`Document agent on ${file} (model ${model})\n`);
runLoop(agent.getId(), documentTask(file), {
  model,
  context: agent.getMemory().getContext(),
  tools: agent.getTools(),
});
