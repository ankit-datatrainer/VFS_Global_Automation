/**
 * Slot Relay configuration.
 *
 * Everything here is safe to edit. Secrets belong in .env (see .env.example),
 * never in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader — avoids a dependency on dotenv. */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

/**
 * The six VFS Bulgaria Visa Application Centres in India that accept
 * long-term (Type D) applications. Source: VFS Global / Embassy of Bulgaria
 * media release, New Delhi, 29 October 2025.
 */
export const CENTRES = [
  {
    code: 'DEL',
    city: 'New Delhi',
    address:
      'Mezzanine Floor, Baba Kharak Singh Marg, Shivaji Stadium Metro Station, Connaught Place',
    liveSince: '2025-11-01',
  },
  {
    code: 'BOM',
    city: 'Mumbai',
    address: 'Trade Centre, First Floor, G Block, Bandra Kurla Complex, Bandra (East)',
    liveSince: '2025-11-15',
  },
  {
    code: 'BLR',
    city: 'Bengaluru',
    address:
      '22, Gopalan Innovation Mall, Bannerghatta Main Rd, Sarakki Industrial Layout, 3rd Phase, J. P. Nagar',
    liveSince: '2025-11-15',
  },
  {
    code: 'MAA',
    city: 'Chennai',
    address: 'Ramee Mall, 2nd Floor, No. 365, Anna Salai, Teynampet',
    liveSince: '2025-11-15',
  },
  {
    code: 'CCU',
    city: 'Kolkata',
    address: '5th Floor, Rene Tower, Plot No. AA-I, 1842, Rajdanga Main Road, Kasba',
    liveSince: '2025-11-15',
  },
  {
    code: 'AMD',
    city: 'Ahmedabad',
    address:
      'Ground Floor, Shree Balaji Agora Mall, Between Tapovan & Bhat Circle, 200 Ft, Sardar Patel Ring Road, Motera',
    liveSince: '2025-11-15',
  },
];

export const CENTRE_CODES = CENTRES.map((c) => c.code);

/** The official booking portal. We link users here; we never automate it. */
export const OFFICIAL_PORTAL = 'https://visa.vfsglobal.com/ind/en/bgr';

export const VISA_CATEGORIES = [
  { code: 'D_WORK', label: 'Type D — Work' },
  { code: 'D_STUDY', label: 'Type D — Study' },
  { code: 'D_FAMILY', label: 'Type D — Family reunification' },
  { code: 'D_OTHER', label: 'Type D — Other long-stay' },
];

export const config = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),

  dashboard: {
    host: process.env.DASHBOARD_HOST || '127.0.0.1',
    port: Number(process.env.DASHBOARD_PORT || 3000),
    /** Shared secret for the "report a sighting" web form. */
    reportToken: process.env.REPORT_TOKEN || '',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    /** Chat IDs allowed to run admin commands, comma-separated. */
    admins: (process.env.TELEGRAM_ADMINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    pollTimeoutSec: 25,
  },

  /**
   * Fairness rules. These exist so that no single person can turn this into a
   * private feed, and so a tout cannot use it as a firehose.
   */
  fairness: {
    /** Max alerts any one subscriber receives per rolling day. */
    maxAlertsPerDay: 12,
    /** Minimum seconds between two alerts to the same subscriber. */
    perSubscriberCooldownSec: 90,
    /**
     * Fan-out order is randomised every time, then delivered in small waves.
     * Nobody gets a systematic head start.
     */
    waveSize: 5,
    waveGapMs: 400,
    /** A subscriber who never reports anything is throttled after this many days. */
    freeriderGraceDays: 14,
    /** Subscribers stay on the list this long after they report a booking. */
    graduationDays: 7,
  },

  alarm: {
    enabled: process.env.ALARM_ENABLED !== 'false',
    /** Repeat the local alarm until acknowledged, up to this many times. */
    maxRepeats: 20,
    repeatGapMs: 2500,
  },

  intel: {
    /** A sighting older than this is no longer "live". */
    sightingTtlMinutes: 45,
    /** Minimum sightings before the heatmap is considered meaningful. */
    minSamplesForPattern: 12,
  },
};

if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });

export default config;
