/**
 * Verifies this machine has everything Slot Relay needs.
 * Run:  npm run check
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import os from 'node:os';

const require = createRequire(import.meta.url);
const results = [];
let fatal = 0;

function check(name, fn, { required = true } = {}) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? 'ok' });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message, required });
    if (required) fatal++;
  }
}

check('Node version >= 22.5', () => {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) {
    throw new Error(`found ${process.version}; need >= 22.5.0 for node:sqlite`);
  }
  return process.version;
});

check('node:sqlite (built-in database)', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE probe(a INTEGER, b TEXT)');
  db.prepare('INSERT INTO probe VALUES(?, ?)').run(7, 'seven');
  const row = db.prepare('SELECT a, b FROM probe').get();
  db.close();
  if (row.a !== 7 || row.b !== 'seven') throw new Error('round-trip failed');
  return 'read/write OK';
});

check('global fetch (Telegram transport)', () => {
  if (typeof fetch !== 'function') throw new Error('fetch is not available');
  return 'available';
});

check('AES-256-GCM + scrypt (vault encryption)', () => {
  const key = crypto.scryptSync('pw', crypto.randomBytes(16), 32, { N: 16384, r: 8, p: 1 });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update('secret', 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const pt = Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  if (pt !== 'secret') throw new Error('encrypt/decrypt round-trip failed');
  return 'round-trip OK';
});

check('node:http (dashboard server)', () => {
  require('node:http');
  return 'available';
});

check('Audio alarm path', () => {
  if (os.platform() === 'win32') return 'PowerShell SoundPlayer + Console.Beep';
  if (os.platform() === 'darwin') return 'afplay';
  return 'paplay/aplay (install pulseaudio-utils or alsa-utils if missing)';
}, { required: false });

const pad = Math.max(...results.map((r) => r.name.length));
console.log('\n  Slot Relay — runtime check\n');
for (const r of results) {
  const mark = r.ok ? '  PASS' : r.required ? '  FAIL' : '  WARN';
  console.log(`${mark}  ${r.name.padEnd(pad)}  ${r.detail}`);
}
console.log('');

if (fatal > 0) {
  console.error(`  ${fatal} required check(s) failed. Fix these before running: npm start\n`);
  process.exit(1);
}
console.log('  All required checks passed. Next:  npm start\n');
