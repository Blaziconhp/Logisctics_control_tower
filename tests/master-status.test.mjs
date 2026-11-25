import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich, matches, metrics, ledgerExport, summarize } from '../lib/analytics.mjs';
import { masterStatus } from '../lib/master-status.mjs';

test('master mapping preserves original status and excludes all pickup pending variants from LM', () => {
  const rows = enrich(['PICKUP EXCEPTION', 'PICKUP SCHEDULED', 'PICKUP RESCHEDULED', 'OUT FOR PICKUP', 'UNDELIVERED-2nd Attempt', 'RTO NDR'].map((status, i) => ({
    order_id: String(i), status, edd: '2026-11-01', warehouse: 'Mumbai', payment: 'COD', details: { source_status: status, lines: [{raw: {'Order Amount': '1,250.50'}, quantity: 2}] },
  })), new Date('2026-11-25'));
  for (const row of rows.slice(0, 4)) {
    assert.equal(row.master_status, 'Pickup Pending');
    assert.equal(row.fm_pending, true);
    assert.equal(row.lm_bucket, null);
    assert.equal(matches(row, {queue: 'lm'}), false);
    assert.equal(row.order_amount, 1250.5);
  }
  assert.equal(rows[0].status, 'PICKUP EXCEPTION');
  assert.equal(rows[4].lm_bucket, 'NDR/EDD breach');
  assert.equal(rows[5].master_status, 'RTO Undelivered');
  assert.equal(metrics(rows).exceptions, 6);
  assert.equal(metrics(rows.filter(r => matches(r, {master_status: ['Pickup Pending']}))).exceptions, 4);
  assert.equal(ledgerExport(rows)[0].warehouse, 'Mumbai');
  assert.equal(ledgerExport(rows)[0].payment, 'COD');
  assert.equal(summarize(rows).outcomes.find(r => r.status === 'Pickup Pending').total, 4);
});

test('unmapped values and mapped terminal categories use the supplied master status', () => {
  assert.equal(masterStatus('Custom carrier status'), 'Custom carrier status');
  assert.equal(masterStatus(''), 'NA');
  const rows = enrich(['UNTRACEABLE', 'CANCELLATION REQUESTED', 'DELIVERED'].map((source_status, i) => ({order_id: String(i), status: 'In Transit', details: {source_status}, edd: '2026-11-01'})), new Date('2026-11-25'));
  assert.equal(metrics(rows).open, 0);
  assert.equal(metrics(rows).delivered, 1);
  assert.equal(metrics(rows).exceptions, 0);
});
