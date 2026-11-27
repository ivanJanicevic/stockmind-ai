import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHuman } from '@mozaik-ai/core';

import type { DocumentDraft } from '../../domain/document-draft.js';
import { answerText, WhenEventFrom } from '../../events.js';
import { join, runLoop, state } from '../../runtime.js';
import { createDocumentAgent, documentTask } from './agent.js';
import { createDocumentTools, type DocumentFile } from './tools.js';

export const DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

const short = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The PDFs the Document agent can read. */
export async function listDocuments(): Promise<DocumentFile[]> {
  const tools = createDocumentTools({ dataDir: DATA_DIR, onDraftSaved: () => {} });
  const result = (await tools.find((t) => t.name === 'list_documents')!.invoke({})) as { documents: DocumentFile[] };
  return result.documents;
}

/**
 * Runs one Document agent loop on one PDF and resolves with the draft it saved.
 * Each document gets its own agent, so several documents can be read at the same time
 * without sharing a model context. Every tool call is printed with the agent's name.
 */
export function processDocument(file: string, model: string): Promise<DocumentDraft> {
  return new Promise((resolve, reject) => {
    const name = `Document agent (${path.basename(file)})`;
    const started = Date.now();
    const log = (line: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] [${name}] ${line}`);

    let saved: DocumentDraft | undefined;
    const tools = createDocumentTools({
      dataDir: DATA_DIR,
      onDraftSaved: (draft) => {
        saved = draft;
        state.drafts.push(draft);
      },
    });
    const agent = createDocumentAgent(tools, name);
    join(agent);

    // Listens to this agent only: prints its tool calls and settles the promise on its answer.
    const listener = createHuman({
      name: `Log of ${name}`,
      capabilities: [],
      handlers: [
        {
          specification: new WhenEventFrom(agent.getId(), ['function_call.started']),
          processor: {
            apply({ event }) {
              const call = (event.payload as { call?: { name?: string; args?: string } }).call;
              log(`-> ${call?.name}(${short(call?.args ?? '')})`);
            },
          },
        },
        {
          specification: new WhenEventFrom(agent.getId(), ['function_call.completed']),
          processor: {
            apply({ event }) {
              const text = (event.payload as { output?: { text?: string } }).output?.text ?? '';
              log(`<- ${short(text.split('\n')[0] ?? '')}`); // read_document: first line is enough
            },
          },
        },
        {
          specification: new WhenEventFrom(agent.getId(), ['model.answer']),
          processor: {
            apply({ event }) {
              const answer = answerText(event.payload);
              log(`answered: ${short(answer)}`);
              if (saved) resolve(saved);
              else reject(new Error(`${name} saved no draft. Its answer: ${answer}`));
            },
          },
        },
      ],
    });
    join(listener);

    runLoop(agent.getId(), documentTask(file), {
      model,
      context: agent.getMemory().getContext(),
      tools: agent.getTools(),
    });
  });
}
