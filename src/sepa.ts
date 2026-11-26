// Builds an ISO 20022 pain.001.001.09 credit transfer file. Draft only: it is
// written to disk for review and never sent to a bank.

export interface Payment {
  endToEndId: string;
  amount: number;
  creditorName: string;
  creditorIban: string;
  creditorBic: string | null;
  remittance: string;
}

export interface Pain001Input {
  messageId: string;
  createdAt: Date;
  executionDate: string; // YYYY-MM-DD
  debtor: { name: string; iban: string; bic: string };
  payments: Payment[];
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c
  );

const compact = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const amount = (n: number) => n.toFixed(2);

export function buildPain001(input: Pain001Input): string {
  const total = input.payments.reduce((sum, p) => sum + p.amount, 0);
  const createdAt = input.createdAt.toISOString().slice(0, 19);

  const transactions = input.payments
    .map(
      (p) => `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${escapeXml(p.endToEndId)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${amount(p.amount)}</InstdAmt></Amt>
        ${p.creditorBic ? `<CdtrAgt><FinInstnId><BICFI>${escapeXml(p.creditorBic)}</BICFI></FinInstnId></CdtrAgt>` : ''}
        <Cdtr><Nm>${escapeXml(p.creditorName)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${compact(p.creditorIban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${escapeXml(p.remittance)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${escapeXml(input.messageId)}</MsgId>
      <CreDtTm>${createdAt}</CreDtTm>
      <NbOfTxs>${input.payments.length}</NbOfTxs>
      <CtrlSum>${amount(total)}</CtrlSum>
      <InitgPty><Nm>${escapeXml(input.debtor.name)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${escapeXml(input.messageId)}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${input.payments.length}</NbOfTxs>
      <CtrlSum>${amount(total)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt><Dt>${input.executionDate}</Dt></ReqdExctnDt>
      <Dbtr><Nm>${escapeXml(input.debtor.name)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${compact(input.debtor.iban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>${escapeXml(input.debtor.bic)}</BICFI></FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${transactions}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
