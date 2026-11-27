import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Tool } from '@mozaik-ai/core';

import {
  checkDraft,
  normalizeDraft,
  type DocumentDraft,
  type DocumentKind,
} from '../../domain/document-draft.js';
import { extractPdfLines, numberLines } from '../../domain/pdf.js';

/** Folders under the data directory, and what kind of document each one holds. */
const FOLDERS: ReadonlyArray<{ folder: string; kind: DocumentKind }> = [
  { folder: 'fakture', kind: 'invoice' },
  { folder: 'otpremnice', kind: 'delivery_note' },
];

export interface DocumentFile {
  /** Path relative to the data directory, e.g. "fakture/faktura-04-sokovi.pdf". */
  file: string;
  kind: DocumentKind;
}

export interface DocumentToolsOptions {
  /** Directory that holds the fakture/ and otpremnice/ folders. */
  dataDir: string;
  /** Called with every draft that passed all checks. */
  onDraftSaved: (draft: DocumentDraft) => void;
}

/** The Document agent's tools: list the PDFs, read one, save what was read from it. */
export function createDocumentTools({ dataDir, onDraftSaved }: DocumentToolsOptions): Tool[] {
  const linesByFile = new Map<string, string[]>();

  async function listDocuments(): Promise<DocumentFile[]> {
    const found: DocumentFile[] = [];
    for (const { folder, kind } of FOLDERS) {
      const names = await readdir(path.join(dataDir, folder));
      for (const name of names.filter((n) => n.toLowerCase().endsWith('.pdf')).sort()) {
        found.push({ file: `${folder}/${name}`, kind });
      }
    }
    return found;
  }

  /** Only files that list_documents returns can be read, so the model cannot open other paths. */
  async function openDocument(file: string): Promise<{ kind: DocumentKind; lines: string[] }> {
    const known = (await listDocuments()).find((d) => d.file === file);
    if (!known) {
      throw new Error(`Unknown document "${file}". Use a file name returned by list_documents.`);
    }
    let lines = linesByFile.get(file);
    if (!lines) {
      const bytes = await readFile(path.join(dataDir, file));
      lines = await extractPdfLines(new Uint8Array(bytes));
      linesByFile.set(file, lines);
    }
    return { kind: known.kind, lines };
  }

  const listDocumentsTool: Tool = {
    type: 'function',
    name: 'list_documents',
    description:
      'Lists the PDF documents waiting to be processed. Each entry has the file name and its kind: ' +
      '"invoice" (faktura) or "delivery_note" (otpremnica).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    strict: true,
    // Wrapped in an object: Gemini accepts a tool result only as a JSON object, not as a list.
    invoke: async () => ({ documents: await listDocuments() }),
  };

  const readDocumentTool: Tool = {
    type: 'function',
    name: 'read_document',
    description:
      'Returns the text of one PDF document, one printed line per row. Every row starts with its line ' +
      'number, e.g. "19| 1. OPT-CC-025 Coca-Cola 0,25 l staklo 96 kom 79,00 ...". Use these line numbers ' +
      'as the source of every value you report.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File name exactly as list_documents returned it.' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async ({ file }: { file: string }) => {
      const { kind, lines } = await openDocument(file);
      return `File: ${file} (${kind}, ${lines.length} lines)\n${numberLines(lines)}`;
    },
  };

  const saveDocumentDraftTool: Tool = {
    type: 'function',
    name: 'save_document_draft',
    description:
      'Saves the header and line items read from one document as a draft for a person to confirm. ' +
      'Copy every value exactly as printed and give the line each item was read from. Every value is ' +
      'checked against the document: if a number or code is not found where you say it is, nothing is ' +
      'saved and the errors are returned so you can correct the draft and call this tool again. ' +
      'If an item has no unit or no expiry date printed, send null for it.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File name exactly as list_documents returned it.' },
        kind: { type: 'string', enum: ['invoice', 'delivery_note'] },
        number: { type: 'string', description: 'Document number as printed, e.g. F-OPT-2026-0931.' },
        date: { type: 'string', description: 'Date the document was issued, as YYYY-MM-DD.' },
        supplier: { type: 'string', description: 'Supplier company name as printed.' },
        relatedDocument: {
          type: ['string', 'null'],
          description:
            'Number of the linked document as printed: the delivery note on an invoice, the purchase ' +
            'order on a delivery note. null if none is printed.',
        },
        items: {
          type: 'array',
          description: 'Every line item of the document, in printed order.',
          items: {
            type: 'object',
            properties: {
              line: { type: 'integer', description: 'Line number from read_document where the item is printed.' },
              supplierCode: { type: ['string', 'null'], description: 'Supplier article code (Šifra) as printed.' },
              name: { type: 'string', description: 'Article name as printed.' },
              unit: {
                type: ['string', 'null'],
                description: 'Unit as printed, e.g. kom or kut; null if no unit is printed.',
              },
              quantity: { type: 'number', description: 'Quantity as printed.' },
              unitPrice: {
                type: ['number', 'null'],
                description: 'Price per unit without VAT as printed; null if the document has no prices.',
              },
              expiryDate: {
                type: ['string', 'null'],
                description: 'Expiry date (Rok trajanja) as YYYY-MM-DD; null if none is printed.',
              },
            },
            required: ['line', 'supplierCode', 'name', 'unit', 'quantity', 'unitPrice', 'expiryDate'],
            additionalProperties: false,
          },
        },
      },
      required: ['file', 'kind', 'number', 'date', 'supplier', 'relatedDocument', 'items'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async (args: unknown) => {
      const draft = normalizeDraft(args);
      const source = await openDocument(draft.file);
      const { errors, warnings, draft: checked } = checkDraft(draft, source);
      if (errors.length > 0) {
        return { saved: false, errors, warnings };
      }
      onDraftSaved(checked);
      return { saved: true, file: checked.file, number: checked.number, items: checked.items.length, warnings };
    },
  };

  return [listDocumentsTool, readDocumentTool, saveDocumentDraftTool];
}
