// Runs the Document agent on one PDF with a real model. This calls Gemini and costs credits.
//
//   npm run agent:document -- fakture/faktura-05-kafa.pdf
//
// Prints every tool call the agent makes, its final answer, and the draft that was saved.

import 'dotenv/config';

import { loadConfig } from '../../config.js';
import { listDocuments, processDocument } from './process-document.js';

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

process.on('unhandledRejection', (error) => fail(`model call failed: ${describeError(error)}`));
setTimeout(() => fail(`no answer within ${config.timeoutMs / 1000}s`), config.timeoutMs).unref();

// Check the file before spending a model call on it.
const known = await listDocuments();
if (!known.some((d) => d.file === file)) {
  fail(`unknown document "${file}". Available:\n${known.map((d) => `  ${d.file}`).join('\n')}`);
}

const model = config.models[0]!;
console.log(`Document agent on ${file} (model ${model})\n`);
try {
  const draft = await processDocument(file, model);
  console.log(`\n${JSON.stringify(draft, null, 2)}`);
  process.exit(0);
} catch (error) {
  fail(describeError(error));
}
