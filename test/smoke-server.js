/**
 * End-to-end smoke test of the dashboard + fan-out path.
 * Uses a throwaway data dir and an ephemeral port. Run: node test/smoke-server.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'slotrelay-smoke-'));
process.env.DASHBOARD_PORT = '0';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.ALARM_ENABLED = 'false';
process.env.REPORT_TOKEN = 'smoke-token';

const cfg = await import('../config.js');
cfg.config.dataDir = TMP;

const store = await import('../src/db.js');
const alerts = await import('../src/alerts.js');
const { createServer } = await import('../src/server.js');

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  if (!cond) failures++;
};

const fanned = [];
const server = createServer({
  onSighting: async (s) => {
    fanned.push(s);
    await alerts.fanOut(s, { ringLocalAlarm: false });
  },
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`\n  Slot Relay — server smoke test\n  ${base}\n`);

const H = { 'content-type': 'application/json', 'x-report-token': 'smoke-token' };

try {
  // 1. index.html
  let res = await fetch(`${base}/`);
  let body = await res.text();
  ok(res.status === 200, 'GET / returns 200');
  ok(/Slot Relay/.test(body), 'index.html renders the app shell');
  ok(/never contacts VFS/i.test(body), 'the no-contact banner is present');

  // 2. static assets
  for (const asset of ['/style.css', '/app.js']) {
    res = await fetch(`${base}${asset}`);
    ok(res.status === 200, `GET ${asset} returns 200`);
  }

  // 3. path traversal is blocked
  res = await fetch(`${base}/../package.json`);
  ok(res.status === 404 || res.status === 403, 'path traversal is refused', `(${res.status})`);

  // 4. state endpoint
  res = await fetch(`${base}/api/state`);
  const state = await res.json();
  ok(res.status === 200, 'GET /api/state returns 200');
  ok(state.centres.length === 6, 'state exposes six centres');
  ok(state.heatmap.grid.length === 7, 'state includes a 7-day heatmap');
  ok(state.portal.includes('visa.vfsglobal.com'), 'state links the official portal');

  // 5. bad token is rejected
  res = await fetch(`${base}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-report-token': 'wrong' },
    body: JSON.stringify({ centre: 'DEL' }),
  });
  ok(res.status === 401, 'POST /api/report rejects a bad token');

  // 6. unknown centre rejected
  res = await fetch(`${base}/api/report`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ centre: 'XXX' }),
  });
  ok(res.status === 400, 'POST /api/report rejects an unknown centre');

  // 7. a real sighting fans out
  store.upsertSubscriber('7001', { centres: 'DEL' });
  store.upsertSubscriber('7002', { centres: 'BOM' });
  res = await fetch(`${base}/api/report`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ centre: 'DEL', slotDates: '15 Sep, 18 Sep', note: 'morning only' }),
  });
  const rep = await res.json();
  ok(res.status === 200 && rep.ok, 'POST /api/report accepts a sighting');
  ok(fanned.length === 1, 'the sighting reached the fan-out handler');
  ok(fanned[0].centre === 'DEL', 'fan-out received the right centre');

  // 8. it shows up as live
  res = await fetch(`${base}/api/state`);
  const s2 = await res.json();
  ok(s2.live.length === 1, 'the sighting is now live');
  ok(s2.live[0].slot_dates === '15 Sep, 18 Sep', 'dates round-tripped');

  // 9. empty check logs without fanning out
  const before = fanned.length;
  res = await fetch(`${base}/api/report`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ centre: 'BLR', empty: true }),
  });
  ok(res.status === 200, 'POST /api/report accepts an empty check');
  ok(fanned.length === before, 'an empty check does NOT wake anybody');

  // 10. gone
  res = await fetch(`${base}/api/gone`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ id: fanned[0].id }),
  });
  ok(res.status === 200, 'POST /api/gone accepts');
  res = await fetch(`${base}/api/state`);
  ok((await res.json()).live.length === 0, 'a gone sighting leaves the live list');

  // 11. unknown api
  res = await fetch(`${base}/api/nope`);
  ok(res.status === 404, 'unknown /api/ path returns 404');
} catch (err) {
  console.error('\n  ERROR:', err.message);
  failures++;
} finally {
  // Let the HTTP server finish closing before touching anything else, then
  // release SQLite. Forcing process.exit() here trips a libuv assertion on
  // Windows, so we set exitCode and let the loop drain naturally instead.
  await new Promise((resolve) => server.close(resolve));
  try {
    store.db.close();
  } catch {}
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n  ${failures === 0 ? 'All server smoke checks passed.' : `${failures} check(s) FAILED.`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
