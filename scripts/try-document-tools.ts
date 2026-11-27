// Calls the Document agent's tools directly, without a model, and prints what the model would see.
// Costs nothing: no API key, no inference.
//
//   npx tsx scripts/try-document-tools.ts                               -> list_documents
//   npx tsx scripts/try-document-tools.ts fakture/faktura-05-kafa.pdf  -> read_document for that file

import { fileURLToPath } from 'node:url';

import { createDocumentTools } from '../src/agents/document/tools.js';

const dataDir = fileURLToPath(new URL('../data', import.meta.url));
const tools = createDocumentTools({ dataDir, onDraftSaved: () => {} });
const tool = (name: string) => tools.find((t) => t.name === name)!;

const file = process.argv[2];
if (file === undefined) {
  console.log('list_documents ->');
  console.log(JSON.stringify(await tool('list_documents').invoke({}), null, 2));
} else {
  console.log(`read_document({ file: "${file}" }) ->`);
  console.log(await tool('read_document').invoke({ file }));
}
