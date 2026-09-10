/**
 * Readiness vault — the applicant's own details, encrypted at rest.
 *
 * SCOPE, DELIBERATELY NARROW:
 *   - This file is for ONE person: whoever owns this computer.
 *   - It never leaves the disk. Nothing here is sent to Telegram, to the
 *     dashboard over the network, or anywhere else.
 *   - It stores NO passwords. Not VFS credentials, not email credentials.
 *     A password manager is the right place for those; this is not one.
 *   - Its only job is to let you fill the official form fast, by hand,
 *     when a slot appears.
 *
 * Crypto: scrypt(N=2^15) -> 32-byte key, AES-256-GCM, random 16-byte salt and
 * 12-byte IV per save, authentication tag verified on load.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';

const VAULT_PATH = path.join(config.dataDir, 'vault.enc');
const MAGIC = 'SRV1';
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Fields we keep. Note the absence of anything that unlocks an account. */
export const FIELDS = [
  { key: 'givenNames', label: 'Given names (exactly as on passport)', required: true },
  { key: 'surname', label: 'Surname (exactly as on passport)', required: true },
  { key: 'passportNumber', label: 'Passport number', required: true },
  { key: 'passportIssue', label: 'Passport issue date (YYYY-MM-DD)', required: true },
  { key: 'passportExpiry', label: 'Passport expiry date (YYYY-MM-DD)', required: true },
  { key: 'dateOfBirth', label: 'Date of birth (YYYY-MM-DD)', required: true },
  { key: 'placeOfBirth', label: 'Place of birth', required: true },
  { key: 'nationality', label: 'Nationality', required: true },
  { key: 'email', label: 'Email used on the VFS account', required: true },
  { key: 'phone', label: 'Mobile number (+91…)', required: true },
  { key: 'addressLine', label: 'Current address', required: true },
  { key: 'city', label: 'City', required: true },
  { key: 'pincode', label: 'PIN code', required: true },
  { key: 'employerName', label: 'Bulgarian employer name', required: false },
  { key: 'permitNumber', label: 'Single permit / work permit reference', required: false },
  { key: 'permitExpiry', label: 'Permit expiry (YYYY-MM-DD)', required: false },
  { key: 'jobStartDate', label: 'Job start date (YYYY-MM-DD)', required: false },
  { key: 'preferredCentre', label: 'Preferred centre (DEL/BOM/BLR/MAA/CCU/AMD)', required: false },
];

export function exists() {
  return fs.existsSync(VAULT_PATH);
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
}

export function save(data, passphrase) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters.');
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify({ data, savedAt: new Date().toISOString() }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob = Buffer.concat([Buffer.from(MAGIC, 'ascii'), salt, iv, tag, ciphertext]);
  fs.writeFileSync(VAULT_PATH, blob, { mode: 0o600 });
  try {
    fs.chmodSync(VAULT_PATH, 0o600);
  } catch {
    /* best effort on Windows */
  }
  return VAULT_PATH;
}

export function load(passphrase) {
  if (!exists()) throw new Error('No vault yet. Run: npm run vault -- init');
  const blob = fs.readFileSync(VAULT_PATH);
  if (blob.subarray(0, 4).toString('ascii') !== MAGIC) {
    throw new Error('Vault file is corrupt or not a Slot Relay vault.');
  }
  const salt = blob.subarray(4, 20);
  const iv = blob.subarray(20, 32);
  const tag = blob.subarray(32, 48);
  const ciphertext = blob.subarray(48);

  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Wrong passphrase, or the vault has been tampered with.');
  }
  return JSON.parse(plaintext.toString('utf8'));
}

/** What is missing before this person can complete a booking without scrambling. */
export function readiness(data) {
  const missing = FIELDS.filter((f) => f.required && !String(data?.[f.key] ?? '').trim());
  const optional = FIELDS.filter((f) => !f.required && !String(data?.[f.key] ?? '').trim());
  const score = Math.round(((FIELDS.length - missing.length - optional.length * 0.3) / FIELDS.length) * 100);

  const warnings = [];
  const expiry = data?.passportExpiry && new Date(data.passportExpiry);
  if (expiry && !Number.isNaN(expiry.getTime())) {
    const monthsLeft = (expiry.getTime() - Date.now()) / (30.44 * 86_400_000);
    if (monthsLeft < 0) warnings.push('Passport has EXPIRED.');
    else if (monthsLeft < 3) {
      warnings.push(`Passport expires in ${Math.round(monthsLeft)} month(s). Bulgaria normally wants 3+ months validity beyond your stay — renew before applying.`);
    }
  }
  const permitExp = data?.permitExpiry && new Date(data.permitExpiry);
  if (permitExp && !Number.isNaN(permitExp.getTime())) {
    const days = Math.ceil((permitExp.getTime() - Date.now()) / 86_400_000);
    if (days < 0) warnings.push('Work permit reference has expired.');
    else if (days < 45) warnings.push(`Work permit expires in ${days} days — this is urgent.`);
  }
  const start = data?.jobStartDate && new Date(data.jobStartDate);
  if (start && !Number.isNaN(start.getTime())) {
    const days = Math.ceil((start.getTime() - Date.now()) / 86_400_000);
    if (days < 45) {
      warnings.push(`Job starts in ${days} days. Type D processing commonly runs several weeks after submission — talk to your employer about the timeline now.`);
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    missingRequired: missing.map((f) => f.label),
    missingOptional: optional.map((f) => f.label),
    warnings,
    ready: missing.length === 0,
  };
}

export const vaultPath = VAULT_PATH;
