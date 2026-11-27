import { defineRuntime, RuntimeState } from '@mozaik-ai/core';

import type { DocumentDraft } from './domain/document-draft.js';
import { preserveGeminiThoughtSignatures } from './gemini-thought-signatures.js';

// One Mozaik runtime per process, shared by every agent of the new flow.
// (src/index.ts, the old invoice-to-SEPA pipeline, defines its own and does not import this.)

/** Shared state: every agent's result lands here. */
export class AppState extends RuntimeState {
  /** Drafts the Document agent saved, in the order they were saved. */
  drafts: DocumentDraft[] = [];
}

preserveGeminiThoughtSignatures(); // without it Gemini rejects the second call of a tool loop

export const state = new AppState();
export const { initializeRuntime, join, runLoop } = defineRuntime<AppState>();
initializeRuntime({ state });
