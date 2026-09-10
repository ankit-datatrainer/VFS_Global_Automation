/**
 * Storage. Uses Node's built-in SQLite (no native build step).
 *
 * DESIGN NOTE — what is deliberately NOT here:
 *   no passport numbers, no dates of birth, no VFS usernames, no VFS passwords.
 * Applicant identity documents live only in the local vault (src/vault.js), on
 * the applicant's own machine, under their own passphrase. The relay only ever
 * knows "a Telegram chat wants alerts for these centres".
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import config from '../config.js';

const DB_PATH = path.join(config.dataDir, 'relay.db');

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS subscribers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id           TEXT    NOT NULL UNIQUE,
  label             TEXT    NOT NULL DEFAULT '',
  centres           TEXT    NOT NULL DEFAULT '',   -- CSV of centre codes, '' = all
  category          TEXT    NOT NULL DEFAULT 'D_WORK',
  earliest_date     TEXT,                          -- ISO date, acceptable window start
  latest_date       TEXT,                          -- ISO date, acceptable window end
  deadline_date     TEXT,                          -- job start / permit expiry, drives priority
  active            INTEGER NOT NULL DEFAULT 1,
  muted_until       TEXT,
  booked_at         TEXT,                          -- set when they report success
  retire_after      TEXT,                          -- graduation date
  reports_made      INTEGER NOT NULL DEFAULT 0,
  alerts_received   INTEGER NOT NULL DEFAULT 0,
  last_alert_at     TEXT,
  alert_day         TEXT,                          -- YYYY-MM-DD bucket
  alerts_today      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sightings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  centre         TEXT    NOT NULL,
  category       TEXT    NOT NULL DEFAULT 'D_WORK',
  slot_dates     TEXT    NOT NULL DEFAULT '',      -- free text, e.g. "15 Sep, 18 Sep"
  note           TEXT    NOT NULL DEFAULT '',
  source         TEXT    NOT NULL,                 -- 'telegram' | 'dashboard'
  reporter_chat  TEXT,
  confirms       INTEGER NOT NULL DEFAULT 0,
  disputes       INTEGER NOT NULL DEFAULT 0,
  gone_at        TEXT,
  created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS empty_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  centre        TEXT NOT NULL,
  reporter_chat TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sighting_id   INTEGER NOT NULL REFERENCES sightings(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  wave          INTEGER NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  sent_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  weekday       INTEGER NOT NULL,                  -- 0=Sun .. 6=Sat
  hour_start    INTEGER NOT NULL,
  hour_end      INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seconds       REAL    NOT NULL,
  fields        INTEGER NOT NULL,
  mistakes      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sightings_created ON sightings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sightings_centre  ON sightings(centre, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alertlog_sighting ON alert_log(sighting_id);
CREATE INDEX IF NOT EXISTS idx_empty_centre      ON empty_checks(centre, created_at DESC);
`);

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Subscribers                                                         */
/* ------------------------------------------------------------------ */

export function upsertSubscriber(chatId, patch = {}) {
  const existing = db.prepare('SELECT * FROM subscribers WHERE chat_id = ?').get(String(chatId));
  if (!existing) {
    db.prepare(
      `INSERT INTO subscribers (chat_id, label, centres, category, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      String(chatId),
      patch.label ?? '',
      patch.centres ?? '',
      patch.category ?? 'D_WORK',
      nowIso(),
    );
  }
  const allowed = [
    'label',
    'centres',
    'category',
    'earliest_date',
    'latest_date',
    'deadline_date',
    'active',
    'muted_until',
    'booked_at',
    'retire_after',
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in patch) {
      sets.push(`${k} = ?`);
      vals.push(patch[k]);
    }
  }
  if (sets.length) {
    vals.push(String(chatId));
    db.prepare(`UPDATE subscribers SET ${sets.join(', ')} WHERE chat_id = ?`).run(...vals);
  }
  return getSubscriber(chatId);
}

export function getSubscriber(chatId) {
  return db.prepare('SELECT * FROM subscribers WHERE chat_id = ?').get(String(chatId));
}

export function listSubscribers({ activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM subscribers WHERE active = 1 ORDER BY id'
    : 'SELECT * FROM subscribers ORDER BY id';
  return db.prepare(sql).all();
}

export function recordAlertSent(sightingId, subscriberId, wave, ok, error) {
  db.prepare(
    `INSERT INTO alert_log (sighting_id, subscriber_id, wave, ok, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sightingId, subscriberId, wave, ok ? 1 : 0, error ?? null, nowIso());

  if (!ok) return;
  const sub = db.prepare('SELECT alert_day, alerts_today FROM subscribers WHERE id = ?').get(subscriberId);
  const day = today();
  const count = sub && sub.alert_day === day ? sub.alerts_today + 1 : 1;
  db.prepare(
    `UPDATE subscribers
        SET alerts_received = alerts_received + 1,
            last_alert_at = ?, alert_day = ?, alerts_today = ?
      WHERE id = ?`,
  ).run(nowIso(), day, count, subscriberId);
}

/* ------------------------------------------------------------------ */
/* Sightings                                                           */
/* ------------------------------------------------------------------ */

export function addSighting({ centre, category = 'D_WORK', slotDates = '', note = '', source, reporterChat = null }) {
  const info = db
    .prepare(
      `INSERT INTO sightings (centre, category, slot_dates, note, source, reporter_chat, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(centre, category, slotDates, note, source, reporterChat, nowIso());

  if (reporterChat) {
    db.prepare('UPDATE subscribers SET reports_made = reports_made + 1 WHERE chat_id = ?').run(
      String(reporterChat),
    );
  }
  return db.prepare('SELECT * FROM sightings WHERE id = ?').get(info.lastInsertRowid);
}

export function addEmptyCheck(centre, reporterChat = null) {
  db.prepare('INSERT INTO empty_checks (centre, reporter_chat, created_at) VALUES (?, ?, ?)').run(
    centre,
    reporterChat,
    nowIso(),
  );
  if (reporterChat) {
    db.prepare('UPDATE subscribers SET reports_made = reports_made + 1 WHERE chat_id = ?').run(
      String(reporterChat),
    );
  }
}

export function markGone(sightingId) {
  db.prepare('UPDATE sightings SET gone_at = ?, disputes = disputes + 1 WHERE id = ? AND gone_at IS NULL').run(
    nowIso(),
    sightingId,
  );
}

export function confirmSighting(sightingId) {
  db.prepare('UPDATE sightings SET confirms = confirms + 1 WHERE id = ?').run(sightingId);
}

export function recentSightings(limit = 50) {
  return db.prepare('SELECT * FROM sightings ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function liveSightings() {
  const cutoff = new Date(Date.now() - config.intel.sightingTtlMinutes * 60_000).toISOString();
  return db
    .prepare(
      `SELECT * FROM sightings
        WHERE gone_at IS NULL AND created_at >= ?
        ORDER BY created_at DESC`,
    )
    .all(cutoff);
}

export function lastSightingForCentre(centre) {
  return db
    .prepare('SELECT * FROM sightings WHERE centre = ? ORDER BY created_at DESC LIMIT 1')
    .get(centre);
}

/* ------------------------------------------------------------------ */
/* Drills                                                              */
/* ------------------------------------------------------------------ */

export function addDrill(seconds, fields, mistakes) {
  db.prepare('INSERT INTO drills (seconds, fields, mistakes, created_at) VALUES (?, ?, ?, ?)').run(
    seconds,
    fields,
    mistakes,
    nowIso(),
  );
}

export function drillStats() {
  const rows = db.prepare('SELECT seconds, mistakes FROM drills ORDER BY created_at DESC LIMIT 20').all();
  if (!rows.length) return null;
  const times = rows.map((r) => r.seconds);
  return {
    runs: rows.length,
    best: Math.min(...times),
    median: times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)],
    lastFive: times.slice(0, 5),
    cleanRuns: rows.filter((r) => r.mistakes === 0).length,
  };
}

export default db;
