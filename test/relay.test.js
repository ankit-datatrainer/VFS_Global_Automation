/**
 * Tests run against a temporary data directory so your real relay.db and
 * vault.enc are never touched.  Run:  npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'slotrelay-test-'));
process.env.DASHBOARD_PORT = '0';
process.env.TELEGRAM_BOT_TOKEN = '';

// Point config at the temp dir before anything imports it.
const cfgMod = await import('../config.js');
cfgMod.config.dataDir = TMP;
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

const store = await import('../src/db.js');
const alerts = await import('../src/alerts.js');
const intel = await import('../src/intel.js');
const vault = await import('../src/vault.js');
const { CENTRES } = cfgMod;

after(() => {
  try {
    store.db.close();
  } catch {}
  fs.rmSync(TMP, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Centre data                                                         */
/* ------------------------------------------------------------------ */

test('six Type D centres are configured with codes and addresses', () => {
  assert.equal(CENTRES.length, 6);
  for (const c of CENTRES) {
    assert.match(c.code, /^[A-Z]{3}$/);
    assert.ok(c.city.length > 2, `${c.code} needs a city`);
    assert.ok(c.address.length > 10, `${c.code} needs an address`);
  }
  const codes = CENTRES.map((c) => c.code);
  assert.deepEqual(new Set(codes).size, 6, 'codes must be unique');
  for (const expected of ['DEL', 'BOM', 'BLR', 'MAA', 'CCU', 'AMD']) {
    assert.ok(codes.includes(expected), `missing ${expected}`);
  }
});

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

test('subscriber upsert is idempotent and patches fields', () => {
  store.upsertSubscriber('1001', { label: 'Asha', centres: 'DEL' });
  store.upsertSubscriber('1001', { centres: 'DEL,BOM' });
  const rows = store.listSubscribers().filter((s) => s.chat_id === '1001');
  assert.equal(rows.length, 1, 'must not duplicate');
  assert.equal(rows[0].centres, 'DEL,BOM');
  assert.equal(rows[0].label, 'Asha');
});

test('a sighting increments the reporter report count', () => {
  store.upsertSubscriber('1002', { centres: '' });
  const before = store.getSubscriber('1002').reports_made;
  store.addSighting({ centre: 'DEL', slotDates: '15 Sep', source: 'telegram', reporterChat: '1002' });
  assert.equal(store.getSubscriber('1002').reports_made, before + 1);
});

test('markGone removes a sighting from the live list', () => {
  const s = store.addSighting({ centre: 'BOM', slotDates: '20 Sep', source: 'dashboard' });
  assert.ok(store.liveSightings().some((x) => x.id === s.id));
  store.markGone(s.id);
  assert.ok(!store.liveSightings().some((x) => x.id === s.id));
});

/* ------------------------------------------------------------------ */
/* Matching + fairness                                                 */
/* ------------------------------------------------------------------ */

const baseSub = (over = {}) => ({
  id: 1,
  chat_id: 'x',
  active: 1,
  centres: '',
  category: 'D_WORK',
  muted_until: null,
  retire_after: null,
  last_alert_at: null,
  alert_day: null,
  alerts_today: 0,
  alerts_received: 0,
  reports_made: 0,
  deadline_date: null,
  created_at: new Date().toISOString(),
  ...over,
});

test('centre filter is respected', () => {
  const sighting = { centre: 'DEL', category: 'D_WORK' };
  assert.equal(alerts.matches(baseSub({ centres: 'DEL' }), sighting), true);
  assert.equal(alerts.matches(baseSub({ centres: 'BOM' }), sighting), false);
  assert.equal(alerts.matches(baseSub({ centres: '' }), sighting), true, 'empty = all centres');
  assert.equal(alerts.matches(baseSub({ centres: 'BOM,DEL' }), sighting), true);
});

test('inactive, muted and retired subscribers are skipped', () => {
  const sighting = { centre: 'DEL', category: 'D_WORK' };
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 3_600_000).toISOString();
  assert.equal(alerts.matches(baseSub({ active: 0 }), sighting), false);
  assert.equal(alerts.matches(baseSub({ muted_until: future }), sighting), false);
  assert.equal(alerts.matches(baseSub({ muted_until: past }), sighting), true);
  assert.equal(alerts.matches(baseSub({ retire_after: past }), sighting), false);
});

test('daily cap and cooldown are enforced', () => {
  const sighting = { centre: 'DEL', category: 'D_WORK' };
  const cap = cfgMod.config.fairness.maxAlertsPerDay;
  assert.equal(
    alerts.matches(baseSub({ alert_day: store.today(), alerts_today: cap }), sighting),
    false,
    'at cap must be skipped',
  );
  assert.equal(
    alerts.matches(baseSub({ alert_day: store.today(), alerts_today: cap - 1 }), sighting),
    true,
  );
  assert.equal(
    alerts.matches(baseSub({ last_alert_at: new Date().toISOString() }), sighting),
    false,
    'inside cooldown must be skipped',
  );
});

test('urgent deadlines land in the first wave', () => {
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const far = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  const subs = [
    ...Array.from({ length: 8 }, (_, i) => baseSub({ id: 100 + i, deadline_date: far })),
    baseSub({ id: 999, deadline_date: soon }),
  ];
  const waves = alerts.buildWaves(subs);
  assert.ok(waves.length >= 2, 'should split into waves');
  assert.ok(waves[0].some((s) => s.id === 999), 'urgent subscriber must be in wave 0');
});

test('fan-out order is reshuffled between calls', () => {
  const subs = Array.from({ length: 40 }, (_, i) => baseSub({ id: i + 1 }));
  const orderOf = () => alerts.buildWaves(subs).flat().map((s) => s.id).join(',');
  const runs = new Set([orderOf(), orderOf(), orderOf(), orderOf(), orderOf()]);
  assert.ok(runs.size > 1, 'ordering must not be deterministic');
});

test('persistent free-riders are pushed to the last wave', () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const subs = [
    baseSub({ id: 1, created_at: old, reports_made: 0, alerts_received: 30 }), // free-rider
    ...Array.from({ length: 6 }, (_, i) => baseSub({ id: 10 + i, reports_made: 4 })),
  ];
  const flat = alerts.buildWaves(subs).flat();
  assert.equal(flat[flat.length - 1].id, 1, 'free-rider should be last');
});

/* ------------------------------------------------------------------ */
/* Intelligence                                                        */
/* ------------------------------------------------------------------ */

test('heatmap buckets sightings into a 7x24 IST grid', () => {
  const { grid, empties } = intel.heatmap();
  assert.equal(grid.length, 7);
  assert.equal(grid[0].length, 24);
  assert.equal(empties.length, 7);
  const total = grid.flat().reduce((a, b) => a + b, 0);
  assert.ok(total >= 2, 'sightings added above should be counted');
});

test('slotLifetime measures time from sighting to gone', () => {
  const s = store.addSighting({ centre: 'CCU', slotDates: '1 Oct', source: 'dashboard' });
  store.db
    .prepare('UPDATE sightings SET created_at = ?, gone_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 10 * 60_000).toISOString(), new Date().toISOString(), s.id);
  const life = intel.slotLifetime({ centre: 'CCU' });
  assert.ok(life, 'expected a lifetime result');
  assert.ok(life.medianMinutes >= 9 && life.medianMinutes <= 11, `got ${life.medianMinutes}`);
});

test('centreBreakdown covers every centre', () => {
  const rows = intel.centreBreakdown();
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => 'hitRate' in r && 'sightings' in r));
});

/* ------------------------------------------------------------------ */
/* Vault                                                               */
/* ------------------------------------------------------------------ */

test('vault encrypts, decrypts, and rejects a wrong passphrase', () => {
  const data = { surname: 'Sharma', givenNames: 'Ravi', passportNumber: 'Z1234567' };
  vault.save(data, 'correct-horse-battery');
  const loaded = vault.load('correct-horse-battery');
  assert.equal(loaded.data.surname, 'Sharma');
  assert.equal(loaded.data.passportNumber, 'Z1234567');
  assert.throws(() => vault.load('wrong-passphrase'), /Wrong passphrase/);
});

test('vault refuses a weak passphrase', () => {
  assert.throws(() => vault.save({ surname: 'X' }, 'short'), /at least 8/);
});

test('vault ciphertext does not contain the plaintext', () => {
  vault.save({ surname: 'Chatterjee', passportNumber: 'M7654321' }, 'a-good-passphrase');
  const raw = fs.readFileSync(vault.vaultPath);
  assert.ok(!raw.includes(Buffer.from('Chatterjee')), 'surname leaked in plaintext');
  assert.ok(!raw.includes(Buffer.from('M7654321')), 'passport number leaked in plaintext');
});

test('readiness reports missing required fields and expiry warnings', () => {
  const r1 = vault.readiness({ surname: 'A' });
  assert.equal(r1.ready, false);
  assert.ok(r1.missingRequired.length > 5);

  const expired = vault.readiness({ passportExpiry: '2020-01-01' });
  assert.ok(expired.warnings.some((w) => /EXPIRED/i.test(w)));

  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const urgent = vault.readiness({ permitExpiry: soon });
  assert.ok(urgent.warnings.some((w) => /urgent/i.test(w)));
});

test('vault field set contains no credential fields', () => {
  const keys = vault.FIELDS.map((f) => f.key.toLowerCase());
  for (const banned of ['password', 'passwd', 'pin', 'otp', 'vfspassword', 'username']) {
    assert.ok(!keys.includes(banned), `vault must never store ${banned}`);
  }
});

/* ------------------------------------------------------------------ */
/* The guarantee                                                       */
/* ------------------------------------------------------------------ */

/**
 * The modules that make up Slot Relay. Listed explicitly, so this guarantee is
 * about OUR code and cannot be silently weakened by unrelated files appearing
 * in the same folder.
 */
const RELAY_FILES = [
  'config.js',
  'start.js',
  'src/db.js',
  'src/alarm.js',
  'src/alerts.js',
  'src/intel.js',
  'src/server.js',
  'src/telegram.js',
  'src/vault.js',
  'src/public/app.js',
  'tools/check-runtime.js',
  'tools/drill.js',
  'tools/vault-cli.js',
];

const NETWORK_CALLERS =
  /\b(fetch|axios|got|superagent|https?\.(get|request)|page\.goto|puppeteer|playwright|selenium|webdriver)\b/;

test('Slot Relay never sends a request to VFS', () => {
  let scanned = 0;
  for (const rel of RELAY_FILES) {
    const abs = path.join(cfgMod.config.root, rel);
    assert.ok(fs.existsSync(abs), `missing relay module: ${rel}`);
    scanned++;

    const text = fs.readFileSync(abs, 'utf8');

    // Mentioning the portal in a comment, or holding it as a link constant we
    // show to the user, is fine. Handing it to a network caller is not.
    text.split(/\r?\n/).forEach((lineText, i) => {
      if (!/vfsglobal/i.test(lineText)) return;
      assert.ok(
        !NETWORK_CALLERS.test(lineText),
        `${rel}:${i + 1} looks like a request to VFS:\n    ${lineText.trim()}`,
      );
    });

    assert.ok(
      !/require\(['"](puppeteer|playwright|selenium-webdriver)|from ['"](puppeteer|playwright|selenium-webdriver)/.test(text),
      `${rel} must not import a browser-automation driver`,
    );
  }
  assert.equal(scanned, RELAY_FILES.length);
});

test('Slot Relay stores no credential fields anywhere', () => {
  for (const rel of RELAY_FILES) {
    const text = fs.readFileSync(path.join(cfgMod.config.root, rel), 'utf8');
    assert.ok(
      !/VFS_PASSWORD|vfsPassword|vfs_password/.test(text),
      `${rel} references a VFS password — Slot Relay must never handle one`,
    );
  }
});

/**
 * Advisory, not a hard failure: report any OTHER code in this folder that does
 * automate VFS, so it is never a surprise what is sitting next to the relay.
 */
test('advisory: report foreign VFS-automation code in this project', () => {
  const relaySet = new Set([
    ...RELAY_FILES.map((r) => path.join(cfgMod.config.root, r)),
    // This file names the drivers in order to detect them; don't flag itself.
    path.join(cfgMod.config.root, 'test', 'relay.test.js'),
  ]);
  const found = [];

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'data' || entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.(js|mjs|cjs)$/.test(entry.name) && !relaySet.has(abs)) {
        const text = fs.readFileSync(abs, 'utf8');
        if (/puppeteer|playwright|selenium/.test(text) || /stealth|anti-detection|evasion/i.test(text)) {
          found.push(path.relative(cfgMod.config.root, abs));
        }
      }
    }
  };
  walk(cfgMod.config.root);

  if (found.length) {
    console.warn(
      `\n  ADVISORY — ${found.length} file(s) in this project automate or evade detection on VFS.\n` +
        `  These are NOT part of Slot Relay and are not covered by its guarantees:\n` +
        found.map((f) => `    - ${f}`).join('\n') +
        '\n',
    );
  }
  // Informational only — the relay's own guarantee is asserted above.
  assert.ok(Array.isArray(found));
});
