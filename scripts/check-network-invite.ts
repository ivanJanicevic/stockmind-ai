// Checks MOZAIK_INVITE in .env without printing the secret part of the link.
// Makes no network call and creates no peer.
//
//   npx tsx scripts/check-network-invite.ts

import 'dotenv/config';

import { HOSTED_NETWORK, readInviteLink } from '@jigjoy/mozaik-network/invite-link';

const raw = (process.env.MOZAIK_INVITE ?? '').trim();

if (raw === '') {
  console.log('MOZAIK_INVITE is missing or empty in .env.');
  process.exit(1);
}

const link = readInviteLink(raw, HOSTED_NETWORK);
if (link && link.invite.startsWith('nt_')) {
  console.log(`OK: invite for ${link.origin} (the part after # starts with nt_).`);
  process.exit(0);
}

if (raw.startsWith('https://') && !raw.includes('#')) {
  console.log(
    `MOZAIK_INVITE is only "${raw}": everything from # on is missing.\n` +
      'In .env, # starts a comment unless the value is in quotes. Write it as:\n' +
      '  MOZAIK_INVITE="https://network.app.jigjoy.ai#nt_..."',
  );
} else {
  console.log('MOZAIK_INVITE is set, but it is not an invite link like https://network.app.jigjoy.ai#nt_...');
}
process.exit(1);
