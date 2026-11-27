import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPaymentCsv } from '../src/payments.js';

test('payment draft is a marked, semicolon CSV with RSD amounts', () => {
  const csv = buildPaymentCsv([
    {
      status: 'ready',
      recipient: 'Mlečni Dvor Promet d.o.o. (izmišljeno)',
      recipientAccount: '000-0000000000003-00',
      amount: 35102.8,
      reference: 'F-MD-2026-55302',
      purpose: 'Plaćanje po računu F-MD-2026-55302',
      valueDate: '2026-12-12',
      payer: 'Kafe „Plava Šolja“ d.o.o. (izmišljeno)',
      payerAccount: '000-0000000000012-00',
      source: 'data/fakture/faktura-06-mleko.pdf: "Za uplatu RSD: 35.102,80"',
    },
  ]);
  const lines = csv.trim().split('\n');
  assert.match(lines[0]!, /DRAFT – NOT SENT/);
  assert.equal(lines.length, 3);
  assert.match(lines[2]!, /^ready;Mlečni Dvor Promet d\.o\.o\. \(izmišljeno\);000-0000000000003-00;35102,80;221;;F-MD-2026-55302;/);
  assert.match(lines[2]!, /"data\/fakture\/faktura-06-mleko\.pdf: ""Za uplatu RSD: 35\.102,80"""$/);
});
