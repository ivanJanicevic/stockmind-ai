// Goods receipt through Mozaik Network. Calls Gemini (one Document agent loop per new delivery
// note) and sends a few network messages.
//
//   npm run receive -- otpremnice/otpremnica-05-kafa.pdf      one delivery note
//   npm run receive -- sve                                     every delivery note in data/otpremnice
//
// 1. Document agents read the delivery notes at the same time; each is saved in SQLite as an
//    OTPREMNICA (NACRT). Notes already in the database are not read again; confirmed ones are skipped.
// 2. The peer "Document agent" posts each note's items in your network (MOZAIK_INVITE in .env).
// 3. Anyone in the network answers: "potvrdi OT-2026-01197" or "potvrdi OT-2026-01197 ZP-ESP-1000=19",
//    from the network's web page or with: npm run owner -- "potvrdi OT-2026-01197".
// 4. A PRIJEMNICA (POTVRDJEN) with the received quantities is written, recording who confirmed it,
//    and the answer is posted. The process ends when every posted note is confirmed.
//
// Only messages that start with "potvrdi" are answered, and no answer starts with it,
// so two processes like this one cannot keep answering each other.

import 'dotenv/config';

import { loadConfig } from '../../config.js';
import { openDatabase } from '../../db/database.js';
import {
  createReceipt,
  draftFromDatabase,
  findDocument,
  findDocumentByFile,
  saveDeliveryNote,
} from '../../db/documents.js';
import type { DocumentDraft } from '../../domain/document-draft.js';
import { parseConfirmation } from '../../domain/receipt-confirmation.js';
import { limitModelCalls } from '../../model-rate-limit.js';
import { connectPeer, PeerDirectory, rule, type MessageSent, type NetworkSession } from '../../network/connect.js';
import { deliveryNoteMessage, receiptMessage } from './messages.js';
import { listDocuments, processDocument } from './process-document.js';

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
process.on('unhandledRejection', (error) => fail(describeError(error)));
limitModelCalls(config.requestsPerMinute);

// Which delivery notes: "sve" or a list of files.
const args = process.argv.slice(2);
const deliveryNotes = (await listDocuments()).filter((d) => d.kind === 'delivery_note').map((d) => d.file);
const files = args.length === 0 || args.includes('sve') ? deliveryNotes : args;
const unknown = files.filter((f) => !deliveryNotes.includes(f));
if (unknown.length > 0) {
  fail(`not delivery notes in data/otpremnice/: ${unknown.join(', ')}\nAvailable:\n  ${deliveryNotes.join('\n  ')}`);
}

// 1. Read the notes that are not in the database yet, all at the same time.
const db = openDatabase();
const isConfirmed = (number: string) => findDocument(db, 'PRIJEMNICA', `PRIJ-${number}`) !== undefined;

const drafts = await Promise.all(
  files.map(async (file): Promise<DocumentDraft> => {
    const stored = findDocumentByFile(db, 'OTPREMNICA', file);
    if (stored) {
      console.log(`[db] ${file}: OTPREMNICA ${stored.broj} is already in the database, not read again`);
      return draftFromDatabase(db, stored);
    }
    const draft = await processDocument(file, config.models[0]!);
    const saved = saveDeliveryNote(db, draft);
    console.log(`[db] ${file}: OTPREMNICA ${draft.number} saved as NACRT (id ${saved.id})`);
    return draft;
  }),
).catch((error) => fail(describeError(error)));

const waiting = new Set(drafts.filter((d) => !isConfirmed(d.number)).map((d) => d.number));
for (const draft of drafts) {
  if (!waiting.has(draft.number)) console.log(`[db] ${draft.number} is already confirmed as PRIJ-${draft.number}`);
}
if (waiting.size === 0) {
  console.log('\nEvery delivery note is already confirmed. Nothing to post.');
  process.exit(0);
}

// 2. Join the network with a policy of two rules.
const directory = new PeerDirectory();
let session: NetworkSession | undefined;

const policy = {
  rules: [
    // Remember who is in the network and with which role.
    rule('receive.track-peers', 1, (e) => PeerDirectory.ENVELOPES.includes(e.type), (e) => directory.observe(e)),
    // A "potvrdi ..." message from someone else.
    rule<MessageSent>(
      'receive.confirmation',
      2,
      (e) =>
        e.type === 'message.sent' &&
        e.senderId !== session?.peer.id &&
        parseConfirmation(String((e.payload as { message?: unknown }).message ?? '')) !== null,
      onConfirmation,
    ),
  ],
};

async function onConfirmation(envelope: MessageSent): Promise<void> {
  if (!session) return;
  const sender = directory.get(envelope.senderId);
  const senderName = sender?.name ?? envelope.payload.senderName ?? envelope.senderId;
  console.log(`\n[network] ${senderName} (role ${sender?.role ?? 'unknown'}): ${envelope.payload.message}`);

  const parsed = parseConfirmation(envelope.payload.message)!;
  if (!parsed.ok) {
    await session.send(parsed.error);
    console.log(`[network] answered: ${parsed.error}`);
    return;
  }

  const result = createReceipt(db, parsed.value, `${senderName} (${envelope.senderId})`);
  if (!result.ok) {
    await session.send(`Prijemnica nije upisana: ${result.error}`);
    console.log(`[db] receipt refused: ${result.error}`);
    return;
  }

  const answer = receiptMessage(result, senderName);
  await session.send(answer);
  console.log(`\n[db] ${answer}`);

  waiting.delete(result.deliveryNote);
  if (waiting.size > 0) {
    console.log(`[network] still waiting for: ${[...waiting].join(', ')}`);
    return;
  }
  console.log('\nEvery posted delivery note is confirmed.');
  await session.leave();
  process.exit(0);
}

session = await connectPeer({ name: 'Document agent', role: 'agent', policy });
console.log(`[network] "Document agent" joined network ${session.networkId}`);

// 3. Ask for a confirmation of each note that is not confirmed yet.
for (const draft of drafts.filter((d) => waiting.has(d.number))) {
  await session.send(deliveryNoteMessage(draft));
  console.log(`[network] posted delivery note ${draft.number} (${draft.file})`);
}
console.log(`[network] waiting for confirmations of: ${[...waiting].join(', ')} (Ctrl+C to stop)`);
