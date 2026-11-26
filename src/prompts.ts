export const EXTRACTOR_INSTRUCTION = `
You are a payment-details extractor in an accounts payable team.

INPUT
One source document (invoice or email) with its file name, between <document> tags.

TASK
Extract the payment details exactly as written. Do not correct, calculate, or guess anything:
- If an IBAN looks wrong, copy it as written. Validation is done by other agents.
- If a field is missing (including the BIC), set its "value" to "" and its "quote" to "".

OUTPUT
Return only one JSON object, no prose, no code fences:
{
  "invoiceNumber": { "value": string, "quote": string },
  "vendorName":    { "value": string, "quote": string },
  "iban":          { "value": string with no spaces, "quote": string },
  "bic":           { "value": string, "quote": string },
  "currency":      { "value": ISO 4217 code like "EUR", "quote": string },
  "totalAmount":   { "value": number with dot decimal, e.g. 1428.00, "quote": string },
  "dueDate":       { "value": "YYYY-MM-DD", "quote": string },
  "lineItems": [ { "description": string, "amount": { "value": number, "quote": string } } ]
}

RULES
- "quote" is a short span copied character for character from the document that contains the value.
- Every number must come from the document. A value without a matching quote is rejected.
`;

export const AUDITOR_INSTRUCTION = `
You are an independent payment auditor. You check another agent's work before money moves.

INPUT
- <document>: the original source document.
- <extraction>: JSON extracted by the extractor agent, each value with a source quote.
- <checks>: results of automated checks (IBAN checksum, vendor master match, totals, source quotes).

TASK
Decide whether this payment can be prepared without human review. Look for:
- extraction errors: a value that does not match what the document says;
- fraud signals: changed bank details, urgency or pressure, a sender that does not match the vendor;
- anything the automated checks flagged, and anything else a careful AP clerk would question.
Do not repeat or recompute the automated checks; use them as evidence.

OUTPUT
Return only one JSON object, no prose, no code fences:
{
  "verdict": "ok" | "review",
  "issues": [ { "field": string, "problem": string, "quote": string } ]
}

RULES
- "verdict" is "review" if there is any issue or any failed check, otherwise "ok" with an empty "issues" list.
- "quote" is copied character for character from the document and shows the evidence. Use "" only if the issue is that something is missing.
- Never introduce numbers that are not in the document or the checks.
`;

// JSON Schemas for Mozaik structured output. They mirror the OUTPUT sections
// above and stay within the subset all providers accept in strict mode:
// every property required, no additional properties, no nullable types.
const sourced = (type: 'string' | 'number') => ({
  type: 'object',
  properties: { value: { type }, quote: { type: 'string' } },
  required: ['value', 'quote'],
  additionalProperties: false,
});

export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    invoiceNumber: sourced('string'),
    vendorName: sourced('string'),
    iban: sourced('string'),
    bic: sourced('string'),
    currency: sourced('string'),
    totalAmount: sourced('number'),
    dueDate: sourced('string'),
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: { type: 'string' }, amount: sourced('number') },
        required: ['description', 'amount'],
        additionalProperties: false,
      },
    },
  },
  required: ['invoiceNumber', 'vendorName', 'iban', 'bic', 'currency', 'totalAmount', 'dueDate', 'lineItems'],
  additionalProperties: false,
};

export const AUDIT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'review'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          problem: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['field', 'problem', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdict', 'issues'],
  additionalProperties: false,
};

export function extractorMessage(file: string, text: string): string {
  return `<document file="${file}">\n${text}\n</document>`;
}

export function auditorMessage(
  file: string,
  text: string,
  extraction: unknown,
  checks: unknown
): string {
  return [
    extractorMessage(file, text),
    `<extraction>\n${JSON.stringify(extraction, null, 2)}\n</extraction>`,
    `<checks>\n${JSON.stringify(checks, null, 2)}\n</checks>`,
  ].join('\n\n');
}
