/**
 * Local dashboard. Binds to 127.0.0.1 by default — not reachable from the
 * network unless you deliberately change DASHBOARD_HOST.
 *
 * The dashboard never displays vault contents. Identity documents stay in the
 * encrypted vault and are read only by the CLI tools, on the terminal.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config, { CENTRES, OFFICIAL_PORTAL, VISA_CATEGORIES } from '../config.js';
import * as store from './db.js';
import * as intel from './intel.js';
import * as alarm from './alarm.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function json(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(buf);
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid JSON');
  }
}

/** Optional shared secret for the report endpoint. */
function authorised(req) {
  if (!config.dashboard.reportToken) return true;
  const hdr = req.headers['x-report-token'];
  return hdr === config.dashboard.reportToken;
}

export function createServer({ onSighting } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;

    try {
      /* ---------------- API ---------------- */

      if (pathname === '/api/state' && req.method === 'GET') {
        const subs = store.listSubscribers();
        const drill = store.drillStats();
        return json(res, 200, {
          portal: OFFICIAL_PORTAL,
          centres: CENTRES,
          categories: VISA_CATEGORIES,
          live: store.liveSightings(),
          recent: store.recentSightings(30),
          breakdown: intel.centreBreakdown(),
          hotWindows: intel.hotWindows(),
          lifetime: intel.slotLifetime(),
          heatmap: intel.heatmap(),
          drill,
          alarmRinging: alarm.isRinging(),
          subscribers: {
            total: subs.length,
            active: subs.filter((s) => s.active).length,
            reporting: subs.filter((s) => s.reports_made > 0).length,
          },
          fairness: config.fairness,
          serverTime: new Date().toISOString(),
        });
      }

      if (pathname === '/api/report' && req.method === 'POST') {
        if (!authorised(req)) return json(res, 401, { error: 'bad report token' });
        const body = await readBody(req);
        const centre = String(body.centre || '').toUpperCase();
        if (!CENTRES.some((c) => c.code === centre)) {
          return json(res, 400, { error: 'unknown centre' });
        }
        if (body.empty) {
          store.addEmptyCheck(centre, null);
          return json(res, 200, { ok: true, kind: 'empty' });
        }
        const sighting = store.addSighting({
          centre,
          category: body.category || 'D_WORK',
          slotDates: String(body.slotDates || '').slice(0, 200),
          note: String(body.note || '').slice(0, 400),
          source: 'dashboard',
        });
        if (onSighting) await onSighting(sighting);
        return json(res, 200, { ok: true, kind: 'sighting', sighting });
      }

      if (pathname === '/api/gone' && req.method === 'POST') {
        if (!authorised(req)) return json(res, 401, { error: 'bad report token' });
        const { id } = await readBody(req);
        if (!Number.isInteger(id)) return json(res, 400, { error: 'id must be an integer' });
        store.markGone(id);
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/alarm/stop' && req.method === 'POST') {
        alarm.stop();
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/alarm/test' && req.method === 'POST') {
        alarm.raise('TEST ALARM — this is a drill');
        return json(res, 200, { ok: true });
      }

      if (pathname.startsWith('/api/')) return json(res, 404, { error: 'no such endpoint' });

      /* ---------------- Static ---------------- */

      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const buf = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': 'no-store',
      });
      res.end(buf);
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
}

export function start({ onSighting } = {}) {
  return new Promise((resolve, reject) => {
    let port = config.dashboard.port;
    const host = config.dashboard.host;

    function tryBind() {
      const server = createServer({ onSighting });
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[server] Port ${port} is in use, trying port ${port + 1}...`);
          port += 1;
          setTimeout(tryBind, 50);
        } else {
          reject(err);
        }
      });
      server.listen(port, host, () => {
        resolve({
          server,
          url: `http://${host}:${port}`,
        });
      });
    }

    tryBind();
  });
}
