import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPain001 } from '../src/sepa.js';
import { debtor } from '../src/data/vendors.js';

test('buildPain001 writes totals, accounts and escapes text', () => {
  const xml = buildPain001({
    messageId: 'MSG-1',
    createdAt: new Date('2026-11-26T10:00:00Z'),
    executionDate: '2026-11-27',
    debtor,
    payments: [
      { endToEndId: 'E1', amount: 1428, creditorName: 'Alpen & Co', creditorIban: 'DE89 3704 0044 0532 0130 00', creditorBic: 'COBADEFFXXX', remittance: 'AK-2026-1001' },
      { endToEndId: 'E2', amount: 275.5, creditorName: 'Brussels Office Supply SA', creditorIban: 'BE68539007547034', creditorBic: null, remittance: 'BOS-2026-0419' },
    ],
  });

  assert.match(xml, /pain\.001\.001\.09/);
  assert.equal(xml.match(/<NbOfTxs>2<\/NbOfTxs>/g)?.length, 2);
  assert.equal(xml.match(/<CtrlSum>1703\.50<\/CtrlSum>/g)?.length, 2);
  assert.match(xml, /<IBAN>DE89370400440532013000<\/IBAN>/);
  assert.match(xml, /<IBAN>DE44500105175407324931<\/IBAN>/);
  assert.match(xml, /Alpen &amp; Co/);
  assert.match(xml, /<ReqdExctnDt><Dt>2026-11-27<\/Dt><\/ReqdExctnDt>/);
});
