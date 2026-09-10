/**
 * Slot Relay — entry point.
 *
 *   npm start
 *
 * What this process does:
 *   - serves the local dashboard on 127.0.0.1
 *   - long-polls the Telegram bot for lookout reports and commands
 *   - fans out sightings fairly, and rings a loud local alarm
 *
 * What this process does NOT do, by design:
 *   - it makes no request of any kind to visa.vfsglobal.com
 *   - it stores no VFS credentials and holds nobody else's identity documents
 *   - it never fills or submits a booking form
 */
import config, { OFFICIAL_PORTAL, CENTRES } from './config.js';
import * as store from './src/db.js';
import * as telegram from './src/telegram.js';
import * as alerts from './src/alerts.js';
import * as alarm from './src/alarm.js';
import * as server from './src/server.js';
import * as vault from './src/vault.js';

const line = (n = 64) => '─'.repeat(n);

async function main() {
  console.log(`\n${line()}\n  SLOT RELAY  ·  Bulgaria Type D  ·  India\n${line()}`);

  /* ---- Sighting handler, shared by Telegram and the dashboard ---- */
  const onSighting = async (sighting) => {
    try {
      await alerts.fanOut(sighting);
    } catch (err) {
      console.error('[fanout] failed:', err.message);
    }
  };

  /* ---- Dashboard ---- */
  const { url } = await server.start({ onSighting });
  console.log(`\n  Dashboard   ${url}`);

  /* ---- Telegram ---- */
  let stopPolling = () => {};
  if (telegram.isConfigured()) {
    try {
      const me = await telegram.getMe();
      console.log(`  Telegram    @${me.username} (connected)`);
      stopPolling = telegram.startPolling({ onSighting });
    } catch (err) {
      console.log(`  Telegram    NOT connected — ${err.message}`);
    }
  } else {
    console.log('  Telegram    not configured (set TELEGRAM_BOT_TOKEN in .env)');
    console.log('              running in local-only mode: dashboard + alarm');
  }

  /* ---- Vault ---- */
  console.log(
    vault.exists()
      ? '  Vault       present (encrypted, local only)'
      : '  Vault       none yet — run: npm run vault -- init',
  );

  /* ---- Status ---- */
  const subs = store.listSubscribers({ activeOnly: true });
  const live = store.liveSightings();
  console.log(`\n  Lookouts    ${subs.length} active`);
  console.log(`  Live now    ${live.length} sighting(s)`);
  console.log(`  Centres     ${CENTRES.map((c) => c.code).join(', ')}`);
  console.log(`\n  Booking is always done by you, by hand, at:\n  ${OFFICIAL_PORTAL}`);
  console.log(`\n${line()}\n  Press Enter to silence a ringing alarm. Ctrl+C to stop.\n${line()}\n`);

  alarm.attachAcknowledgeKey();

  /* ---- Housekeeping ---- */
  const sweep = setInterval(() => {
    try {
      alerts.sweepRetired();
    } catch (err) {
      console.error('[sweep]', err.message);
    }
  }, 3_600_000);

  /* ---- Shutdown ---- */
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    console.log('\n  Shutting down…');
    clearInterval(sweep);
    stopPolling();
    alarm.stop();
    try {
      store.db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('\n  Fatal:', err.message, '\n');
  process.exit(1);
});
