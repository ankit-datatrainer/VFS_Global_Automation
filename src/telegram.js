/**
 * Telegram Bot API client + long-poll command loop.
 * Implemented directly on global fetch so the project keeps zero dependencies.
 */
import config, { CENTRES, CENTRE_CODES, OFFICIAL_PORTAL } from '../config.js';
import * as store from './db.js';

const API = (method) => `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;

export function isConfigured() {
  return Boolean(config.telegram.botToken);
}

async function call(method, payload, { timeoutMs = 30_000 } = {}) {
  if (!isConfigured()) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(API(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const json = await res.json().catch(() => ({ ok: false, description: 'non-JSON response' }));
    if (!json.ok) throw new Error(json.description || `Telegram ${method} failed (${res.status})`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', {
    chat_id: String(chatId),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function getMe() {
  return call('getMe', {}, { timeoutMs: 10_000 });
}

/* ------------------------------------------------------------------ */
/* Command surface                                                     */
/* ------------------------------------------------------------------ */

const centreByToken = (token) => {
  if (!token) return null;
  const t = token.trim().toUpperCase();
  const byCode = CENTRES.find((c) => c.code === t);
  if (byCode) return byCode;
  return CENTRES.find((c) => c.city.toUpperCase().replace(/\s+/g, '') === t.replace(/\s+/g, ''));
};

const HELP = `<b>Slot Relay</b> — a shared lookout for Bulgaria Type D appointments.

This bot never touches the VFS website. Every alert comes from a real person who
was already on the site and tapped to share what they saw.

<b>When you see slots</b>
/seen &lt;centre&gt; [dates]  — tell everyone. e.g. <code>/seen DEL 15 Sep, 18 Sep</code>
/gone &lt;id&gt;              — that sighting is used up
/empty &lt;centre&gt;         — you looked, nothing there (this builds the pattern map)

<b>Your settings</b>
/watch &lt;centres&gt;        — e.g. <code>/watch DEL BOM</code>, or <code>/watch all</code>
/deadline &lt;YYYY-MM-DD&gt;  — your job start or permit expiry, sets your priority
/mute &lt;hours&gt;           — quiet for a while
/unmute
/booked                 — you got one. Congratulations — you stay on for 7 more days to help others.

<b>Info</b>
/status    — what is live right now
/pattern   — when slots have actually appeared
/centres   — the six centres
/stop      — leave

Official booking portal: ${OFFICIAL_PORTAL}`;

function fmtAge(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

/**
 * @param {object} msg  Telegram message object
 * @param {object} deps { onSighting }  — injected so the loop stays testable
 */
export async function handleCommand(msg, deps = {}) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return null;

  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const rest = args.join(' ').trim();

  store.upsertSubscriber(chatId, { label: msg.from?.first_name || '' });

  switch (cmd) {
    case '/start':
    case '/help':
      return sendMessage(chatId, HELP);

    case '/centres':
      return sendMessage(
        chatId,
        '<b>Bulgaria Type D centres in India</b>\n\n' +
          CENTRES.map((c) => `<b>${c.code}</b> — ${c.city}\n<i>${c.address}</i>`).join('\n\n'),
      );

    case '/watch': {
      if (!rest) return sendMessage(chatId, 'Usage: <code>/watch DEL BOM</code> or <code>/watch all</code>');
      if (rest.toLowerCase() === 'all') {
        store.upsertSubscriber(chatId, { centres: '', active: 1 });
        return sendMessage(chatId, 'Watching <b>all six centres</b>.');
      }
      const codes = [];
      for (const tok of args) {
        const c = centreByToken(tok);
        if (!c) return sendMessage(chatId, `Unknown centre: <code>${tok}</code>\nValid: ${CENTRE_CODES.join(', ')}`);
        codes.push(c.code);
      }
      store.upsertSubscriber(chatId, { centres: codes.join(','), active: 1 });
      return sendMessage(chatId, `Watching <b>${codes.join(', ')}</b>.`);
    }

    case '/deadline': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rest)) {
        return sendMessage(chatId, 'Usage: <code>/deadline 2026-11-30</code> (your job start or permit expiry)');
      }
      store.upsertSubscriber(chatId, { deadline_date: rest });
      const days = Math.ceil((new Date(rest).getTime() - Date.now()) / 86_400_000);
      return sendMessage(
        chatId,
        `Deadline set: <b>${rest}</b> (${days} days away).\nUrgent cases are alerted in the earliest wave.`,
      );
    }

    case '/seen': {
      const centre = centreByToken(args[0]);
      if (!centre) {
        return sendMessage(chatId, `Usage: <code>/seen DEL 15 Sep, 18 Sep</code>\nValid: ${CENTRE_CODES.join(', ')}`);
      }
      const dates = args.slice(1).join(' ');
      const sighting = store.addSighting({
        centre: centre.code,
        slotDates: dates,
        source: 'telegram',
        reporterChat: chatId,
      });
      if (deps.onSighting) await deps.onSighting(sighting);
      return sendMessage(
        chatId,
        `Thank you — relayed to everyone watching <b>${centre.city}</b>.\nSighting id <code>${sighting.id}</code>. If they get taken, send <code>/gone ${sighting.id}</code>.`,
      );
    }

    case '/empty': {
      const centre = centreByToken(args[0]);
      if (!centre) return sendMessage(chatId, `Usage: <code>/empty DEL</code>`);
      store.addEmptyCheck(centre.code, chatId);
      return sendMessage(chatId, `Logged: nothing at <b>${centre.city}</b> right now. This sharpens the pattern map.`);
    }

    case '/gone': {
      const id = Number(args[0]);
      if (!Number.isInteger(id)) return sendMessage(chatId, 'Usage: <code>/gone 42</code>');
      store.markGone(id);
      return sendMessage(chatId, `Marked sighting <code>${id}</code> as gone.`);
    }

    case '/status': {
      const live = store.liveSightings();
      if (!live.length) {
        return sendMessage(chatId, 'Nothing live right now.\nWhen you are next on the portal, <code>/empty DEL</code> or <code>/seen DEL …</code> helps everyone.');
      }
      return sendMessage(
        chatId,
        '<b>Live sightings</b>\n\n' +
          live
            .map(
              (s) =>
                `<b>${s.centre}</b> ${s.slot_dates || '(dates not given)'} — ${fmtAge(s.created_at)}` +
                `\n  id <code>${s.id}</code>${s.confirms ? ` · ${s.confirms} confirmed` : ''}`,
            )
            .join('\n\n') +
          `\n\n${OFFICIAL_PORTAL}`,
      );
    }

    case '/pattern': {
      const { renderPatternText } = await import('./intel.js');
      return sendMessage(chatId, renderPatternText());
    }

    case '/mute': {
      const hours = Number(args[0]) || 8;
      const until = new Date(Date.now() + hours * 3_600_000).toISOString();
      store.upsertSubscriber(chatId, { muted_until: until });
      return sendMessage(chatId, `Muted for ${hours}h.`);
    }

    case '/unmute':
      store.upsertSubscriber(chatId, { muted_until: null });
      return sendMessage(chatId, 'Unmuted.');

    case '/booked': {
      const retire = new Date(Date.now() + config.fairness.graduationDays * 86_400_000).toISOString();
      store.upsertSubscriber(chatId, { booked_at: store.nowIso(), retire_after: retire });
      return sendMessage(
        chatId,
        `Congratulations.\n\nYou will keep receiving alerts for ${config.fairness.graduationDays} more days — please keep reporting what you see, so the next person gets the help you got. After that you are retired automatically.`,
      );
    }

    case '/stop':
      store.upsertSubscriber(chatId, { active: 0 });
      return sendMessage(chatId, 'You are off the list. <code>/watch all</code> to come back.');

    default:
      return sendMessage(chatId, `Unknown command.\n\n${HELP}`);
  }
}

/* ------------------------------------------------------------------ */
/* Long-poll loop                                                      */
/* ------------------------------------------------------------------ */

export function startPolling(deps = {}) {
  let offset = 0;
  let stopped = false;
  let backoff = 1000;

  (async function loop() {
    while (!stopped) {
      try {
        const updates = await call(
          'getUpdates',
          { offset, timeout: config.telegram.pollTimeoutSec, allowed_updates: ['message'] },
          { timeoutMs: (config.telegram.pollTimeoutSec + 10) * 1000 },
        );
        backoff = 1000;
        for (const u of updates) {
          offset = u.update_id + 1;
          if (!u.message?.text) continue;
          try {
            await handleCommand(u.message, deps);
          } catch (err) {
            console.error('[telegram] command failed:', err.message);
          }
        }
      } catch (err) {
        if (stopped) break;
        console.error('[telegram] poll error:', err.message);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  })();

  return () => {
    stopped = true;
  };
}
