import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { reviewSanitizedSettlementSample,sanitizeMarketplaceSettlementCsv,verifySettlementSampleAcceptance } from '@commerce/finance';

const raw=`Report owner,Acme Seller,,,,,,,,\nStatement ID,Settlement Date,Total Settlement Amount,Order/Adjustment ID,Transaction ID,Settlement Amount,Type,Buyer Name,Phone,Customer Email\nTT-REAL-PAYOUT-01,2026/09/20,"1,200.00",ORDER-REAL-001,TX-REAL-001,"600.00",Order,Somchai Example,0812345678,buyer@example.com\nTT-REAL-PAYOUT-01,2026/09/20,"1,200.00",ORDER-REAL-001,TX-REAL-002,"600.00",Order,Somchai Example,0812345678,buyer@example.com\n`;
const key='local-test-redaction-key-32-characters-minimum';
const adapterKey='tiktok-shop-th' as const;
function source(csv:string){return {shopId:'00000000-0000-4000-8000-000000000000',filename:'tiktok-redacted.csv',contentBase64:Buffer.from(csv).toString('base64'),contentType:'text/csv' as const,delimiter:',' as const,adapterKey:'tiktok-shop-th' as const};}

describe('Settlement sample intake',()=>{
  it('blocks an adapter-compatible sample that still contains direct identifiers and raw source IDs',async()=>{
    const review=await reviewSanitizedSettlementSample(source(raw));
    expect(review.status).toBe('blocked');expect(review.adapter?.key).toBe('tiktok-shop-th');
    expect(review.redaction.findings.map(item=>item.code)).toEqual(expect.arrayContaining(['SENSITIVE_COLUMN_VALUE','EMAIL_VALUE','PHONE_VALUE','UNSAFE_IDENTIFIER']));
    expect(JSON.stringify(review)).not.toContain('Somchai');expect(JSON.stringify(review)).not.toContain('0812345678');expect(JSON.stringify(review)).not.toContain('buyer@example.com');expect(JSON.stringify(review)).not.toContain('Buyer Name');
  });

  it('creates a stable pseudonymized CSV that preserves adapter structure, dates, signs and totals',async()=>{
    const first=sanitizeMarketplaceSettlementCsv({csv:raw,redactionKey:key,adapterKey}),second=sanitizeMarketplaceSettlementCsv({csv:raw,redactionKey:key,adapterKey});
    expect(first.csv).toBe(second.csv);expect(first.csv).not.toContain('Acme Seller');expect(first.csv).not.toContain('Somchai');expect(first.csv).not.toContain('0812345678');expect(first.csv).not.toContain('buyer@example.com');
    expect(first.csv).not.toContain('ORDER-REAL-001');expect(first.csv).toContain('2026/09/20');expect(first.csv).toContain('"1,200.00"');
    const orderTokens=[...first.csv.matchAll(/ANON-ORDER-[A-F0-9]{20}/g)].map(match=>match[0]);expect(orderTokens).toHaveLength(2);expect(new Set(orderTokens).size).toBe(1);
    expect(first.manifest).toMatchObject({version:'settlement-sample-intake-v1',headerRow:2,rows:2,columns:10,unknownColumns:'redacted',notes:'classified'});
    expect(first.manifest.sanitizedSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('marks the sanitized sample ready for finance review without claiming financial sign-off',async()=>{
    const prepared=sanitizeMarketplaceSettlementCsv({csv:raw,redactionKey:key,adapterKey}),review=await reviewSanitizedSettlementSample(source(prepared.csv));
    expect(review).toMatchObject({status:'ready_for_finance_review',redaction:{passed:true,findings:[]},semantics:{rows:2,payouts:1,reportedTotalRows:2,positiveRows:2,nonPositiveRows:0,invalidRows:0}});
    expect(review.lineage.sanitizedSha256).toBe(prepared.manifest.sanitizedSha256);expect(review.limitations).toContain('รายงานนี้ไม่ยืนยันความถูกต้องของยอดหรือความครบถ้วนของ export');
  });

  it('requires the finance sign-off to match the exact sanitized file and golden totals',async()=>{
    const prepared=sanitizeMarketplaceSettlementCsv({csv:raw,redactionKey:key,adapterKey}),review=await reviewSanitizedSettlementSample(source(prepared.csv));
    const acceptance={version:'settlement-sample-intake-v1',adapterKey,schemaVersion:'tiktok-shop-th-statement-v1',sanitizedSha256:prepared.manifest.sanitizedSha256,
      source:{exportedAt:'2026-09-23T00:00:00.000Z',sellerCenterTimezone:'Asia/Bangkok',currency:'THB'},
      expected:{rowCount:2,payoutCount:1,allocatedTotalMinor:120_000,reportedPayoutTotalMinor:120_000},
      review:{reviewer:'ผู้ตรวจการเงิน',reviewedAt:'2026-09-23T01:00:00.000Z',headersCorrect:true,datesCorrect:true,signsCorrect:true,identitySemanticsCorrect:true,totalsCorrect:true,notes:'เทียบกับหน้ารายงานต้นทางและยอดตรงกัน'},decision:'accepted'};
    const verified=verifySettlementSampleAcceptance(review,acceptance);expect(verified.passed).toBe(true);expect(verified.checks.every(check=>check.passed)).toBe(true);
    const wrongHash=verifySettlementSampleAcceptance(review,{...acceptance,sanitizedSha256:'f'.repeat(64)});expect(wrongHash.passed).toBe(false);expect(wrongHash.checks.find(check=>check.id==='source_hash')?.passed).toBe(false);
  });

  it('rejects short pseudonymization keys',()=>{
    expect(()=>sanitizeMarketplaceSettlementCsv({csv:raw,redactionKey:'short',adapterKey})).toThrow('อย่างน้อย 32');
  });

  for(const [keyName,file] of [
    ['tiktok-shop-th','tiktok-settlement-synthetic.csv'],['shopee-th','shopee-income-synthetic.csv'],['lazada-th','lazada-statement-synthetic.csv'],
  ] as const)it(`keeps the ${keyName} adapter detectable after redaction`,async()=>{
    const csv=await readFile(`apps/web/public/examples/${file}`,'utf8'),prepared=sanitizeMarketplaceSettlementCsv({csv,redactionKey:key,adapterKey:keyName});
    const review=await reviewSanitizedSettlementSample({shopId:'00000000-0000-4000-8000-000000000000',filename:`${keyName}-redacted.csv`,contentBase64:Buffer.from(prepared.csv).toString('base64'),contentType:'text/csv',delimiter:',',adapterKey:keyName});
    expect(review.status).toBe('ready_for_finance_review');expect(review.adapter?.key).toBe(keyName);expect(review.redaction.findings).toEqual([]);
  });
});
