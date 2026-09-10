/**
 * Fan-out engine.
 *
 * FAIRNESS IS THE POINT OF THIS FILE. A slot feed that always reaches the same
 * people first is just a private feed with extra steps, and a feed with no caps
 * is exactly the firehose an appointment tout wants. So:
 *
 *   1. Delivery order is reshuffled on every single sighting. The only thing
 *      that earns an earlier wave is a genuinely near deadline.
 *   2. Every subscriber has a daily alert cap and a per-alert cooldown.
 *   3. People who take alerts for weeks without ever reporting anything get
 *      moved to the back — the network only works if lookouts look out.
 *   4. Nobody can request a "just me" feed; there is no such command.
 */
import config, { CENTRES, OFFICIAL_PORTAL } from '../config.js';
import * as store from './db.js';
import * as telegram from './telegram.js';
import * as alarm from './alarm.js';

const centreName = (code) => CENTRES.find((c) => c.code === code)?.city || code;

/** Cryptographically unbiased shuffle, so ordering cannot be gamed. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function daysUntil(iso) {
  if (!iso) return Infinity;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** True when this subscriber wants to hear about this sighting. */
export function matches(sub, sighting) {
  if (!sub.active) return false;

  if (sub.retire_after && new Date(sub.retire_after) < new Date()) return false;
  if (sub.muted_until && new Date(sub.muted_until) > new Date()) return false;

  if (sub.centres) {
    const wanted = sub.centres.split(',').map((s) => s.trim()).filter(Boolean);
    if (wanted.length && !wanted.includes(sighting.centre)) return false;
  }
  if (sub.category && sighting.category && sub.category !== sighting.category) return false;

  // Daily cap
  if (sub.alert_day === store.today() && sub.alerts_today >= config.fairness.maxAlertsPerDay) {
    return false;
  }
  // Cooldown
  if (sub.last_alert_at) {
    const since = (Date.now() - new Date(sub.last_alert_at).getTime()) / 1000;
    if (since < config.fairness.perSubscriberCooldownSec) return false;
  }
  return true;
}

/**
 * Order recipients into waves.
 * Wave 0: genuinely urgent (deadline within 30 days), shuffled among themselves.
 * Wave 1+: everyone else, shuffled, with persistent free-riders last.
 */
export function buildWaves(subs) {
  const urgent = [];
  const normal = [];
  const freeriders = [];

  const graceMs = config.fairness.freeriderGraceDays * 86_400_000;

  for (const s of subs) {
    const isOldAccount = Date.now() - new Date(s.created_at).getTime() > graceMs;
    if (isOldAccount && s.reports_made === 0 && s.alerts_received > 5) {
      freeriders.push(s);
    } else if (daysUntil(s.deadline_date) <= 30) {
      urgent.push(s);
    } else {
      normal.push(s);
    }
  }

  const ordered = [...shuffle(urgent), ...shuffle(normal), ...shuffle(freeriders)];
  const waves = [];
  for (let i = 0; i < ordered.length; i += config.fairness.waveSize) {
    waves.push(ordered.slice(i, i + config.fairness.waveSize));
  }
  return waves;
}

function renderAlert(sighting) {
  const dates = sighting.slot_dates ? `\n<b>Dates seen:</b> ${sighting.slot_dates}` : '';
  const note = sighting.note ? `\n<i>${sighting.note}</i>` : '';
  return (
    `🔔 <b>SLOTS REPORTED — ${centreName(sighting.centre)}</b>${dates}${note}\n\n` +
    `Reported by another applicant just now. Go and look:\n${OFFICIAL_PORTAL}\n\n` +
    `If you get one: <code>/booked</code>\n` +
    `If they are already gone: <code>/gone ${sighting.id}</code>`
  );
}

/**
 * Deliver a sighting to everyone who matches, in fair waves.
 * @returns {Promise<{sent:number, skipped:number, failed:number}>}
 */
export async function fanOut(sighting, { ringLocalAlarm = true } = {}) {
  const all = store.listSubscribers({ activeOnly: true });
  const eligible = all.filter((s) => matches(s, sighting));
  const skipped = all.length - eligible.length;

  if (ringLocalAlarm) {
    alarm.raise(`SLOTS AT ${centreName(sighting.centre).toUpperCase()} — ${sighting.slot_dates || 'dates unknown'}`);
  }

  if (!telegram.isConfigured()) {
    console.warn('[alerts] TELEGRAM_BOT_TOKEN not set — local alarm only.');
    return { sent: 0, skipped, failed: 0 };
  }

  const waves = buildWaves(eligible);
  const text = renderAlert(sighting);
  let sent = 0;
  let failed = 0;

  for (let w = 0; w < waves.length; w++) {
    await Promise.all(
      waves[w].map(async (sub) => {
        try {
          await telegram.sendMessage(sub.chat_id, text);
          store.recordAlertSent(sighting.id, sub.id, w, true, null);
          sent++;
        } catch (err) {
          store.recordAlertSent(sighting.id, sub.id, w, false, err.message);
          failed++;
        }
      }),
    );
    if (w < waves.length - 1) {
      await new Promise((r) => setTimeout(r, config.fairness.waveGapMs));
    }
  }

  console.log(
    `[alerts] sighting #${sighting.id} ${sighting.centre}: sent=${sent} skipped=${skipped} failed=${failed} waves=${waves.length}`,
  );
  return { sent, skipped, failed };
}

/** Retire graduated subscribers. Called periodically by start.js. */
export function sweepRetired() {
  const now = new Date().toISOString();
  const rows = store.db
    .prepare('SELECT id, chat_id FROM subscribers WHERE active = 1 AND retire_after IS NOT NULL AND retire_after < ?')
    .all(now);
  for (const r of rows) {
    store.db.prepare('UPDATE subscribers SET active = 0 WHERE id = ?').run(r.id);
  }
  if (rows.length) console.log(`[alerts] retired ${rows.length} graduated subscriber(s)`);
  return rows.length;
}
