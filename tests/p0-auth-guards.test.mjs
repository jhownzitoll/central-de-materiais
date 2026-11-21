import test from 'node:test';
import assert from 'node:assert/strict';

const endpoint = 'https://pkpihrxucorfbniltdtk.supabase.co/functions/v1';
const endpoints = [
  'ibuild-order-pdf',
  'ibuild-order-document-init',
  'ibuild-order-doc-link',
  'ibuild-owner-email-dispatch',
];

// Read-only security contract. These requests are intentionally unauthenticated;
// they must never generate orders, issue signed PDFs, or enqueue email.
for (const name of endpoints) {
  test(name + ' blocks a POST without an authenticated session', async () => {
    const res = await fetch(endpoint + '/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(res.status, 401, name + ': expected HTTP 401, got ' + res.status);
  });
}

test('owner email dispatcher rejects forged cron signatures', async () => {
  const res = await fetch(endpoint + '/ibuild-owner-email-dispatch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ibuild-cron-ts': '1',
      'x-ibuild-cron-signature': 'not-a-valid-signature',
    },
    body: JSON.stringify({ action: 'readiness' }),
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(res.status, 403);
});

test('public iBuild frontend remains reachable', async () => {
  const res = await fetch('https://central-de-materiais.jonathan20014-jsdo.workers.dev', {
    method: 'GET',
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<html/i);
});
