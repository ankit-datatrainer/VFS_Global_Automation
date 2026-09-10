/**
 * Booking drill —  npm run drill
 *
 * The slot is not lost because you type slowly. It is lost because you were
 * hunting for your passport number while the page timed out. This drill makes
 * the sequence automatic, against a LOCAL mock only. It never opens, contacts,
 * or submits anything to VFS.
 */
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import * as vault from '../src/vault.js';
import { addDrill, drillStats } from '../src/db.js';
import { OFFICIAL_PORTAL } from '../config.js';

const rl = readline.createInterface({ input, output });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function askSecret(q) {
  output.write(q);
  const wasRaw = input.isRaw;
  if (input.isTTY) input.setRawMode(true);
  let buf = '';
  const answer = await new Promise((resolve) => {
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          input.off('data', onData);
          if (input.isTTY) input.setRawMode(wasRaw ?? false);
          output.write('\n');
          return resolve(buf);
        }
        if (ch === '\u0003') {
          output.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    input.on('data', onData);
  });
  return answer;
}

/** The fields the real form asks for, in the order it asks for them. */
const SEQUENCE = [
  'surname',
  'givenNames',
  'dateOfBirth',
  'placeOfBirth',
  'nationality',
  'passportNumber',
  'passportIssue',
  'passportExpiry',
  'email',
  'phone',
  'addressLine',
  'city',
  'pincode',
];

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

console.log(`
  ${'='.repeat(62)}
  BOOKING DRILL
  ${'='.repeat(62)}

  This is a practice run against a local mock. Nothing is sent anywhere.
  Type each value from memory, as fast as you can, correctly.

  The real form lives at:
    ${OFFICIAL_PORTAL}
  You will always fill that one yourself, by hand.
`);

let data;
try {
  const pass = await askSecret('  Vault passphrase: ');
  ({ data } = vault.load(pass));
} catch (err) {
  console.error(`\n  ${err.message}`);
  console.error('  Run "npm run vault -- init" first.\n');
  rl.close();
  process.exit(1);
}

const fields = SEQUENCE.map((key) => ({
  key,
  label: vault.FIELDS.find((f) => f.key === key)?.label || key,
  expected: data[key],
})).filter((f) => String(f.expected ?? '').trim());

if (fields.length < 5) {
  console.error('\n  Your vault is too empty to drill. Run: npm run vault -- edit\n');
  rl.close();
  process.exit(1);
}

await ask(`  ${fields.length} fields. Press Enter to start the clock...`);

const t0 = performance.now();
let mistakes = 0;
const perField = [];

for (const f of fields) {
  const fieldStart = performance.now();
  const answer = await ask(`  ${f.label}: `);
  const elapsed = (performance.now() - fieldStart) / 1000;
  const correct = norm(answer) === norm(f.expected);
  if (!correct) {
    mistakes++;
    console.log(`     wrong — should be: ${f.expected}`);
  }
  perField.push({ label: f.label, seconds: elapsed, correct });
}

const total = (performance.now() - t0) / 1000;
addDrill(Math.round(total * 100) / 100, fields.length, mistakes);

console.log(`\n  ${'='.repeat(62)}`);
console.log(`  Time: ${total.toFixed(1)}s over ${fields.length} fields · ${mistakes} mistake(s)`);
console.log(`  ${'='.repeat(62)}\n`);

const slowest = perField.slice().sort((a, b) => b.seconds - a.seconds).slice(0, 3);
console.log('  Slowest fields — these are what cost you the slot:');
slowest.forEach((f) => console.log(`    ${f.seconds.toFixed(1)}s  ${f.label}${f.correct ? '' : '  (and wrong)'}`));

const wrong = perField.filter((f) => !f.correct);
if (wrong.length) {
  console.log('\n  Got wrong:');
  wrong.forEach((f) => console.log(`    - ${f.label}`));
}

const stats = drillStats();
if (stats && stats.runs > 1) {
  console.log(`\n  History: ${stats.runs} runs · best ${stats.best.toFixed(1)}s · median ${stats.median.toFixed(1)}s · ${stats.cleanRuns} clean`);
}

console.log('');
if (total <= 60 && mistakes === 0) {
  console.log('  Under a minute, no mistakes. You are ready.\n');
} else if (mistakes > 0) {
  console.log('  Accuracy first. A rejected form wastes the slot completely — run it again.\n');
} else {
  console.log(`  Aim for under 60s. You are ${(total - 60).toFixed(0)}s over. Run it again.\n`);
}

rl.close();
