// The café owner in Mozaik Network: a peer with role "user". Sends no model calls.
//
//   npm run owner                                       shows the latest messages in the network
//   npm run owner -- "potvrdi OT-2026-01197"            confirms a delivery note and waits for the answer
//   npm run owner -- "potvrdi OT-2026-01197 ZP-ESP-1000=19"
//
// The name shown in the network is MOZAIK_OWNER_NAME from .env (default "Vlasnik").
// Confirming from the network's web page works the same way.

import 'dotenv/config';

import {
  connectPeer,
  rule,
  type MessageSent,
  type NetworkSession,
  type PeerWelcomed,
} from '../network/connect.js';

const REPLY_TIMEOUT_MS = 30_000;

const text = process.argv.slice(2).join(' ').trim();
const name = process.env.MOZAIK_OWNER_NAME?.trim() || 'Vlasnik';

const time = (date: Date | string) => new Date(date).toTimeString().slice(0, 8);
const print = (when: Date | string, who: string, message: string) =>
  console.log(`\n[${time(when)}] ${who}:\n${message}`);

let session: NetworkSession | undefined;
let waitingForReply = false;

async function finish(code: number): Promise<never> {
  await session?.leave().catch(() => {});
  process.exit(code);
}

const policy = {
  rules: [
    // On joining, the network sends the latest messages (up to 20), oldest first.
    rule<PeerWelcomed>('owner.welcomed', 1, (e) => e.type === 'peer.welcomed', (e) => {
      console.log(`Joined network "${e.payload.network.name}" as "${name}" (role user).`);
      if (text !== '') return; // sending: the history is not needed
      const messages = e.payload.messages.filter((m) => m.type === 'message.sent');
      if (messages.length === 0) console.log('No messages yet.');
      for (const m of messages) print(m.createdAt, m.payload.senderName ?? m.senderId, m.payload.message ?? '');
    }),
    // A message from someone else: print it; if it answers ours, we are done.
    rule<MessageSent>(
      'owner.message',
      2,
      (e) => e.type === 'message.sent' && e.senderId !== session?.peer.id,
      async (e) => {
        print(e.createdAt, e.payload.senderName ?? e.senderId, e.payload.message);
        if (waitingForReply) await finish(0);
      },
    ),
  ],
};

session = await connectPeer({ name, role: 'user', policy });

if (text === '') {
  await finish(0);
}

waitingForReply = true;
await session.send(text);
console.log(`\nSent: ${text}\nWaiting up to ${REPLY_TIMEOUT_MS / 1000}s for an answer...`);
setTimeout(() => {
  console.log('No answer. Is "npm run receive" still running?');
  void finish(1);
}, REPLY_TIMEOUT_MS);
