/* Slot Relay dashboard — vanilla JS, no build step. */

const $ = (id) => document.getElementById(id);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let state = null;
let reportToken = localStorage.getItem('reportToken') || '';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (reportToken) headers['x-report-token'] = reportToken;
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

/* ---------------- render ---------------- */

function renderLive() {
  const el = $('live');
  if (!state.live.length) {
    el.innerHTML =
      '<p class="muted">Nothing live right now.<br>Next time you check the portal, use the panel on the right — even "nothing there" helps.</p>';
    return;
  }
  el.innerHTML = state.live
    .map((s) => {
      const city = state.centres.find((c) => c.code === s.centre)?.city || s.centre;
      return `<div class="sighting">
        <div>
          <div class="where">${esc(city)}</div>
          <div class="dates">${esc(s.slot_dates) || '<span class="muted">dates not given</span>'}</div>
          ${s.note ? `<div class="when">${esc(s.note)}</div>` : ''}
          <div class="when">${ago(s.created_at)} · id ${s.id}${s.confirms ? ` · ${s.confirms} confirmed` : ''}</div>
        </div>
        <button class="btn" data-gone="${s.id}">Gone</button>
      </div>`;
    })
    .join('');

  el.querySelectorAll('[data-gone]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('/api/gone', { method: 'POST', body: JSON.stringify({ id: Number(btn.dataset.gone) }) });
        await refresh();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    }),
  );
}

function renderHeat() {
  const { grid, empties } = state.heatmap;
  let max = 0;
  for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) max = Math.max(max, grid[w][h]);

  const parts = ['<div class="hlabel"></div>'];
  for (let h = 0; h < 24; h++) parts.push(`<div class="hlabel">${h % 3 === 0 ? h : ''}</div>`);

  for (let w = 0; w < 7; w++) {
    parts.push(`<div class="dlabel">${DAYS[w]}</div>`);
    for (let h = 0; h < 24; h++) {
      const hits = grid[w][h];
      const obs = hits + empties[w][h];
      let bg = '#171d29';
      if (max > 0 && hits > 0) {
        const a = 0.18 + 0.82 * (hits / max);
        bg = `rgba(77,163,255,${a.toFixed(2)})`;
      } else if (obs > 0) {
        bg = '#1e2532';
      }
      const title = obs ? `${DAYS[w]} ${String(h).padStart(2, '0')}:00 — ${hits} of ${obs} checks` : `${DAYS[w]} ${String(h).padStart(2, '0')}:00 — no checks yet`;
      parts.push(`<div class="cell" style="background:${bg}" title="${title}"></div>`);
    }
  }
  $('heat').innerHTML = parts.join('');

  $('hotList').innerHTML = state.hotWindows.length
    ? state.hotWindows
        .map(
          (w) =>
            `<span class="chip">${DAYS[w.weekday]} ${String(w.hour).padStart(2, '0')}:00 · ${Math.round(w.rate * 100)}% of ${w.observations}</span>`,
        )
        .join('')
    : '<span class="muted small">No window stands out yet — keep logging checks.</span>';
}

function renderBreakdown() {
  $('breakdown').innerHTML = state.breakdown
    .map((b) => {
      const pct = b.hitRate == null ? 0 : Math.round(b.hitRate * 100);
      return `<div class="brow">
        <span class="code">${b.code}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="muted small">${b.sightings}/${b.sightings + b.emptyChecks}</span>
      </div>`;
    })
    .join('');
}

function renderStats() {
  const lt = state.lifetime;
  $('lifetime').innerHTML = lt
    ? `${lt.medianMinutes}<span class="unit">min median</span>
       <div class="stat-sub">fastest ${lt.fastestMinutes} min · ${lt.samples} samples</div>`
    : '<span class="muted">No data yet</span>';

  const d = state.drill;
  $('drill').innerHTML = d
    ? `${d.best.toFixed(1)}<span class="unit">s best</span>
       <div class="stat-sub">${d.runs} runs · median ${d.median.toFixed(1)}s · ${d.cleanRuns} clean</div>`
    : '<span class="muted">Never run</span>';

  const s = state.subscribers;
  $('subs').innerHTML = `${s.active}<span class="unit">active</span>
    <div class="stat-sub">${s.reporting} have reported · max ${state.fairness.maxAlertsPerDay} alerts/day each</div>`;
}

function renderRecent() {
  $('recent').innerHTML = state.recent.length
    ? state.recent
        .map(
          (s) => `<div class="rrow ${s.gone_at ? 'gone' : ''}">
            <span class="rcode">${s.centre}</span>
            <span>${esc(s.slot_dates) || '<span class="muted">—</span>'}${s.note ? ` · <span class="muted">${esc(s.note)}</span>` : ''}</span>
            <span class="muted">${ago(s.created_at)}${s.gone_at ? ' · gone' : ''}</span>
          </div>`,
        )
        .join('')
    : '<p class="muted">Nothing reported yet.</p>';
}

function renderAlarm() {
  $('alarmCard').hidden = !state.alarmRinging;
}

function render() {
  $('portalLink').href = state.portal;
  renderLive();
  renderHeat();
  renderBreakdown();
  renderStats();
  renderRecent();
  renderAlarm();
}

/* ---------------- actions ---------------- */

async function refresh() {
  try {
    state = await api('/api/state');
    if (!$('repCentre').options.length) {
      $('repCentre').innerHTML = state.centres
        .map((c) => `<option value="${c.code}">${c.code} — ${esc(c.city)}</option>`)
        .join('');
    }
    render();
    $('pulse').style.background = 'var(--good)';
  } catch (err) {
    $('pulse').style.background = 'var(--bad)';
    console.error(err);
  }
}

function msg(text, kind) {
  const el = $('repMsg');
  el.textContent = text;
  el.className = `msg ${kind || ''}`;
  if (kind === 'ok') setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 5000);
}

async function report(empty) {
  const body = {
    centre: $('repCentre').value,
    slotDates: $('repDates').value.trim(),
    note: $('repNote').value.trim(),
    empty,
  };
  if (!empty && !body.slotDates && !confirm('Send a sighting with no dates? Dates help people decide whether to rush.')) {
    return;
  }
  try {
    await api('/api/report', { method: 'POST', body: JSON.stringify(body) });
    msg(empty ? 'Logged — thank you. This sharpens the pattern map.' : 'Relayed to everyone watching that centre.', 'ok');
    $('repDates').value = '';
    $('repNote').value = '';
    await refresh();
  } catch (err) {
    if (/report token/i.test(err.message)) {
      const t = prompt('This dashboard needs its REPORT_TOKEN (from your .env):');
      if (t) {
        reportToken = t.trim();
        localStorage.setItem('reportToken', reportToken);
        return report(empty);
      }
    }
    msg(err.message, 'err');
  }
}

$('btnSeen').addEventListener('click', () => report(false));
$('btnEmpty').addEventListener('click', () => report(true));
$('stopAlarm').addEventListener('click', async () => {
  await api('/api/alarm/stop', { method: 'POST' });
  await refresh();
});
$('testAlarm').addEventListener('click', async () => {
  await api('/api/alarm/test', { method: 'POST' });
  await refresh();
});

setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
}, 1000);

refresh();
setInterval(refresh, 5000);
