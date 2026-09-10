/**
 * Slot pattern intelligence.
 *
 * Built purely from what humans reported: "/seen" (slots were there) and
 * "/empty" (I looked, nothing). Over a few weeks that produces a real
 * weekday x hour map of when Bulgaria releases appointments — which is the
 * single most useful thing this project can tell an applicant, because it
 * turns "refresh forever" into "be ready on Tuesday at 11".
 *
 * All times are IST (Asia/Kolkata), because that is when the applicants and
 * the centres both live.
 */
import config, { CENTRES } from '../config.js';
import { db } from './db.js';

const IST_OFFSET_MIN = 330; // UTC+05:30

export function toIst(iso) {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
}

/** weekday 0=Sun..6=Sat and hour 0..23, both in IST. */
function bucket(iso) {
  const d = toIst(iso);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

/**
 * @returns {{grid:number[][], empties:number[][], total:number, samples:number}}
 *   grid[weekday][hour] = number of sightings observed in that slot
 */
export function heatmap({ centre = null, days = 90 } = {}) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const empties = Array.from({ length: 7 }, () => new Array(24).fill(0));

  const sightSql = centre
    ? 'SELECT created_at FROM sightings WHERE created_at >= ? AND centre = ?'
    : 'SELECT created_at FROM sightings WHERE created_at >= ?';
  const sightRows = centre
    ? db.prepare(sightSql).all(cutoff, centre)
    : db.prepare(sightSql).all(cutoff);

  for (const r of sightRows) {
    const { weekday, hour } = bucket(r.created_at);
    grid[weekday][hour]++;
  }

  const emptySql = centre
    ? 'SELECT created_at FROM empty_checks WHERE created_at >= ? AND centre = ?'
    : 'SELECT created_at FROM empty_checks WHERE created_at >= ?';
  const emptyRows = centre
    ? db.prepare(emptySql).all(cutoff, centre)
    : db.prepare(emptySql).all(cutoff);

  for (const r of emptyRows) {
    const { weekday, hour } = bucket(r.created_at);
    empties[weekday][hour]++;
  }

  return {
    grid,
    empties,
    total: sightRows.length,
    samples: sightRows.length + emptyRows.length,
  };
}

/**
 * Hit rate per weekday/hour = sightings / (sightings + empty checks).
 * Only reported where there is enough evidence to mean anything.
 */
export function hotWindows({ centre = null, days = 90, minObservations = 3, limit = 8 } = {}) {
  const { grid, empties } = heatmap({ centre, days });
  const out = [];
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const hits = grid[w][h];
      const obs = hits + empties[w][h];
      if (obs < minObservations || hits === 0) continue;
      out.push({ weekday: w, hour: h, hits, observations: obs, rate: hits / obs });
    }
  }
  out.sort((a, b) => b.rate - a.rate || b.hits - a.hits);
  return out.slice(0, limit);
}

/** Median minutes a sighting stayed live before someone said /gone. */
export function slotLifetime({ centre = null, days = 90 } = {}) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const sql = centre
    ? 'SELECT created_at, gone_at FROM sightings WHERE gone_at IS NOT NULL AND created_at >= ? AND centre = ?'
    : 'SELECT created_at, gone_at FROM sightings WHERE gone_at IS NOT NULL AND created_at >= ?';
  const rows = centre ? db.prepare(sql).all(cutoff, centre) : db.prepare(sql).all(cutoff);
  if (!rows.length) return null;

  const mins = rows
    .map((r) => (new Date(r.gone_at).getTime() - new Date(r.created_at).getTime()) / 60_000)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  if (!mins.length) return null;

  return {
    samples: mins.length,
    medianMinutes: Math.round(mins[Math.floor(mins.length / 2)] * 10) / 10,
    fastestMinutes: Math.round(mins[0] * 10) / 10,
  };
}

export function centreBreakdown({ days = 90 } = {}) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return CENTRES.map((c) => {
    const seen = db
      .prepare('SELECT COUNT(*) AS n FROM sightings WHERE centre = ? AND created_at >= ?')
      .get(c.code, cutoff).n;
    const empty = db
      .prepare('SELECT COUNT(*) AS n FROM empty_checks WHERE centre = ? AND created_at >= ?')
      .get(c.code, cutoff).n;
    const last = db
      .prepare('SELECT created_at FROM sightings WHERE centre = ? ORDER BY created_at DESC LIMIT 1')
      .get(c.code);
    return {
      code: c.code,
      city: c.city,
      sightings: seen,
      emptyChecks: empty,
      hitRate: seen + empty > 0 ? seen / (seen + empty) : null,
      lastSeen: last?.created_at || null,
    };
  });
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

/** Plain-text pattern summary for the /pattern Telegram command. */
export function renderPatternText({ centre = null } = {}) {
  const { total, samples } = heatmap({ centre });
  const where = centre ? CENTRES.find((c) => c.code === centre)?.city || centre : 'all centres';

  if (samples < config.intel.minSamplesForPattern) {
    return (
      `<b>Pattern map — ${where}</b>\n\n` +
      `Not enough data yet (${samples} observations, need ${config.intel.minSamplesForPattern}).\n\n` +
      `Every time you check the portal, send <code>/empty DEL</code> or <code>/seen DEL …</code>. ` +
      `Even "nothing there" is valuable — it is what makes the good hours stand out.`
    );
  }

  const hot = hotWindows({ centre });
  const life = slotLifetime({ centre });

  let out = `<b>Pattern map — ${where}</b>\n${total} sightings from ${samples} observations (IST)\n\n`;

  if (hot.length) {
    out += '<b>Most likely windows</b>\n';
    for (const w of hot) {
      out += `${DAYS[w.weekday].slice(0, 3)} ${hh(w.hour)} — ${Math.round(w.rate * 100)}% of ${w.observations} checks\n`;
    }
  } else {
    out += 'No window stands out yet.\n';
  }

  if (life) {
    out += `\n<b>How fast they go</b>\nMedian ${life.medianMinutes} min before someone reported them gone`;
    out += ` (fastest ${life.fastestMinutes} min, ${life.samples} samples).\n`;
    out += life.medianMinutes < 5
      ? '\nThat is brutal. Run <code>npm run drill</code> until you can fill the form in under 60 seconds.'
      : '\nYou have a little breathing room — but practise the drill anyway.';
  }

  return out;
}
