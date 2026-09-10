/**
 * Vault CLI —  npm run vault -- <init|show|check|edit>
 *
 * Your details never leave this machine. The passphrase is never stored.
 */
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import * as vault from '../src/vault.js';

const rl = readline.createInterface({ input, output });
const ask = (q) => new Promise((res) => rl.question(q, res));

/** Prompt without echoing keystrokes. */
async function askSecret(q) {
  output.write(q);
  const wasRaw = input.isRaw;
  if (input.isTTY) input.setRawMode(true);
  let buf = '';
  const answer = await new Promise((resolve) => {
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
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
        if (ch === '\u007f' || ch === '\b') {
          buf = buf.slice(0, -1);
        } else {
          buf += ch;
        }
      }
    };
    input.on('data', onData);
  });
  return answer;
}

function printReadiness(r) {
  console.log(`\n  Readiness: ${r.score}%  ${r.ready ? '— ready to book' : '— not ready yet'}`);
  if (r.missingRequired.length) {
    console.log('\n  Missing (required):');
    r.missingRequired.forEach((m) => console.log(`    - ${m}`));
  }
  if (r.missingOptional.length) {
    console.log('\n  Missing (optional but useful):');
    r.missingOptional.forEach((m) => console.log(`    - ${m}`));
  }
  if (r.warnings.length) {
    console.log('\n  Warnings:');
    r.warnings.forEach((w) => console.log(`    !  ${w}`));
  }
  console.log('');
}

async function cmdInit() {
  console.log('\n  Setting up your readiness vault.');
  console.log('  Everything stays on this computer, encrypted. Press Enter to skip a field.\n');

  const data = {};
  for (const f of vault.FIELDS) {
    const tag = f.required ? '' : ' (optional)';
    data[f.key] = (await ask(`  ${f.label}${tag}: `)).trim();
  }

  console.log('\n  Choose a passphrase to encrypt this. Minimum 8 characters.');
  console.log('  If you forget it, the vault cannot be recovered.\n');
  let pass;
  for (;;) {
    pass = await askSecret('  Passphrase: ');
    const again = await askSecret('  Confirm:    ');
    if (pass !== again) {
      console.log('  They do not match. Try again.\n');
      continue;
    }
    if (pass.length < 8) {
      console.log('  Too short — at least 8 characters.\n');
      continue;
    }
    break;
  }

  vault.save(data, pass);
  console.log(`\n  Saved, encrypted, to ${vault.vaultPath}`);
  printReadiness(vault.readiness(data));
}

async function cmdShow({ masked = true } = {}) {
  const pass = await askSecret('  Passphrase: ');
  const { data, savedAt } = vault.load(pass);
  console.log(`\n  Vault (last saved ${savedAt})\n`);
  for (const f of vault.FIELDS) {
    let v = data[f.key] || '';
    if (masked && v && /passport|permit/i.test(f.key)) {
      v = v.length > 4 ? `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : '****';
    }
    console.log(`  ${f.label.padEnd(46)} ${v || '—'}`);
  }
  printReadiness(vault.readiness(data));
  if (masked) console.log('  (Passport/permit numbers masked. Use "vault -- reveal" to show them.)\n');
}

async function cmdCheck() {
  const pass = await askSecret('  Passphrase: ');
  const { data } = vault.load(pass);
  printReadiness(vault.readiness(data));
}

async function cmdEdit() {
  const pass = await askSecret('  Passphrase: ');
  const { data } = vault.load(pass);
  console.log('\n  Press Enter to keep the current value.\n');
  for (const f of vault.FIELDS) {
    const cur = data[f.key] || '';
    const shown = cur ? ` [${cur}]` : '';
    const next = (await ask(`  ${f.label}${shown}: `)).trim();
    if (next) data[f.key] = next;
  }
  vault.save(data, pass);
  console.log('\n  Updated.');
  printReadiness(vault.readiness(data));
}

const cmd = process.argv[2] || 'show';
try {
  if (cmd === 'init') await cmdInit();
  else if (cmd === 'show') await cmdShow({ masked: true });
  else if (cmd === 'reveal') await cmdShow({ masked: false });
  else if (cmd === 'check') await cmdCheck();
  else if (cmd === 'edit') await cmdEdit();
  else {
    console.log('\n  Usage: npm run vault -- <init|show|reveal|check|edit>\n');
  }
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
}
