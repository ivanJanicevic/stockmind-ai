// Goods receipt through Mozaik Network. Calls Gemini (one Document agent loop) and sends a few
// network messages.
//
//   npm run receive -- otpremnice/otpremnica-05-kafa.pdf
//
// 1. The Document agent reads the delivery note; it is saved in SQLite as an OTPREMNICA (NACRT).
// 2. The peer "Document agent" posts its items in your network (MOZAIK_INVITE in .env).
// 3. Anyone in the network answers: "potvrdi OT-2026-01197" or "potvrdi OT-2026-01197 ZP-ESP-1000=19",
//    from the network's web page or with: npm run owner -- "potvrdi OT-2026-01197".
// 4. A PRIJEMNICA (POTVRDJEN) with the received quantities is written, recording who confirmed it,
//    and the answer is posted.
//
// Only messages that start with "potvrdi" are answered, and no answer starts with it,
// so two processes like this one cannot keep answering each other.

import 'dotenv/config';

import { loadConfig } from '../../config.js';
import { openDatabase } from '../../db/database.js';
import { createReceipt, saveDeliveryNote } from '../../db/documents.js';
import { parseConfirmation } from '../../domain/receipt-confirmation.js';
import { connectPeer, PeerDirectory, rule, type MessageSent, type NetworkSession } from '../../network/connect.js';
import { deliveryNoteMessage, receiptMessage } from './messages.js';
import { listDocuments, processDocument } from './process-document.js';

const file = process.argv[2] ?? 'otpremnice/otpremnica-05-kafa.pdf';

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

const known = (await listDocuments()).find((d) => d.file === file);
if (!known || known.kind !== 'delivery_note') {
  fail(`"${file}" is not one of the delivery notes in data/otpremnice/.`);
}

// 1. Read the delivery note and keep it in the database as a draft.
const db = openDatabase();
const draft = await processDocument(file, config.models[0]!).catch((error) => fail(describeError(error)));
const stored = saveDeliveryNote(db, draft);
console.log(
  `\n[db] OTPREMNICA ${draft.number} ${stored.created ? 'saved as NACRT' : 'was already in the database'} (id ${stored.id})`,
);

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

  if (result.deliveryNote === draft.number) {
    await session.leave();
    process.exit(0);
  }
}

session = await connectPeer({ name: 'Document agent', role: 'agent', policy });
console.log(`[network] "Document agent" joined network ${session.networkId}`);

// 3. Ask the owner to check the goods against the delivery note.
await session.send(deliveryNoteMessage(draft));
console.log(`[network] posted delivery note ${draft.number}; waiting for anyone in the network to confirm (Ctrl+C to stop)`);
