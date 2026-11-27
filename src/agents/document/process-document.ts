import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DocumentDraft } from '../../domain/document-draft.js';
import { state } from '../../runtime.js';
import { runAgent } from '../run-agent.js';
import { createDocumentAgent, documentTask } from './agent.js';
import { createDocumentTools, type DocumentFile } from './tools.js';

export const DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

/** The PDFs the Document agent can read. */
export async function listDocuments(): Promise<DocumentFile[]> {
  const tools = createDocumentTools({ dataDir: DATA_DIR, onDraftSaved: () => {} });
  const result = (await tools.find((t) => t.name === 'list_documents')!.invoke({})) as { documents: DocumentFile[] };
  return result.documents;
}

/**
 * Runs one Document agent loop on one PDF and resolves with the draft it saved.
 * Each document gets its own agent, so several documents can be read at the same time
 * without sharing a model context.
 */
export async function processDocument(file: string, model: string): Promise<DocumentDraft> {
  const name = `Document agent (${path.basename(file)})`;
  let saved: DocumentDraft | undefined;
  const tools = createDocumentTools({
    dataDir: DATA_DIR,
    onDraftSaved: (draft) => {
      saved = draft;
      state.drafts.push(draft);
    },
  });

  const answer = await runAgent(createDocumentAgent(tools, name), documentTask(file), model, name);
  if (!saved) throw new Error(`${name} saved no draft. Its answer: ${answer}`);
  return saved;
}
