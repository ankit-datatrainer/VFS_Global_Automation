/**
 * Telegram Bot — Instant slot alerts via Telegram
 * Sends rich notifications with one-tap booking links
 */

const TelegramBot = require('node-telegram-bot-api');
const config = require('../../config');

class TelegramAlerts {
  constructor() {
    this.bot = null;
    this.isEnabled = false;
  }

  /**
   * Initialize the Telegram bot
   */
  async init() {
    if (!config.alerts.telegram.enabled || !config.alerts.telegram.token) {
      console.log('[Telegram] ⚠️ Telegram alerts disabled (no token configured)');
      return;
    }

    try {
      this.bot = new TelegramBot(config.alerts.telegram.token, { polling: true });
      this.isEnabled = true;

      // Handle /start command
      this.bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        this.bot.sendMessage(chatId, `
🎯 *VFS Slot Hunter — Connected!*

Your Chat ID: \`${chatId}\`
Add this to your \`.env\` file as \`TELEGRAM_CHAT_IDS\`

*Available Commands:*
/status — Current monitor status
/check — Force an immediate check
/pause — Pause monitoring
/resume — Resume monitoring
/help — Show this message
        `, { parse_mode: 'Markdown' });
      });

      // Handle /help command
      this.bot.onText(/\/help/, (msg) => {
        this.bot.sendMessage(msg.chat.id, `
📖 *VFS Slot Hunter Commands*

/status — Show monitor status
/check — Force check now
/pause — Pause monitoring
/resume — Resume monitoring
/candidates — List candidates
/history — Recent check history
/patterns — Slot pattern insights
        `, { parse_mode: 'Markdown' });
      });

      console.log('[Telegram] ✅ Bot initialized');

      // Send startup notification
      await this.sendToAll('🟢 *VFS Slot Hunter started!*\n\nMonitoring appointment slots...');

    } catch (error) {
      console.error(`[Telegram] ❌ Failed to initialize: ${error.message}`);
      this.isEnabled = false;
    }
  }

  /**
   * Register command handlers (called by main app to connect scheduler)
   */
  registerCommands(scheduler) {
    if (!this.bot) return;

    this.bot.onText(/\/status/, async (msg) => {
      const status = scheduler.getStatus();
      const statusEmoji = status.isRunning ? (status.schedulerPaused ? '⏸️' : '🟢') : '🔴';

      this.bot.sendMessage(msg.chat.id, `
${statusEmoji} *Monitor Status*

🏙️ City: ${status.targetCity}
📊 Total Checks: ${status.totalChecks}
🎯 Slots Found: ${status.slotsFound}
⏱️ Uptime: ${status.uptime}
🔴 Failures: ${status.consecutiveFailures}
🕐 Last Check: ${status.lastCheck ? status.lastCheck.toLocaleString('en-IN') : 'Never'}
      `, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/check/, async (msg) => {
      this.bot.sendMessage(msg.chat.id, '⚡ Force checking now...');
      try {
        const slots = await scheduler.forceCheck();
        if (slots.length === 0) {
          this.bot.sendMessage(msg.chat.id, '😔 No slots found.');
        }
      } catch (error) {
        this.bot.sendMessage(msg.chat.id, `❌ Check failed: ${error.message}`);
      }
    });

    this.bot.onText(/\/pause/, (msg) => {
      scheduler.pause();
      this.bot.sendMessage(msg.chat.id, '⏸️ Monitoring paused. Use /resume to continue.');
    });

    this.bot.onText(/\/resume/, async (msg) => {
      this.bot.sendMessage(msg.chat.id, '▶️ Resuming monitoring...');
      await scheduler.resume();
    });
  }

  /**
   * Send slot found alert
   */
  async sendSlotAlert(slotData) {
    if (!this.isEnabled) return;

    const { slots, city, timestamp } = slotData;
    const dateList = slots.map(s => `  📅 ${s.date}`).join('\n');

    const message = `
🚨🚨🚨 *SLOT FOUND!* 🚨🚨🚨

🏙️ *City:* ${city}
📅 *Available Dates:*
${dateList}

⏰ *Detected at:* ${timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

⚡ *ACTION REQUIRED:*
Open the booking page NOW and complete the booking!

🔗 [Open VFS Booking Page](${config.vfs.bookingUrl})

_Quick-book launcher is opening on your PC..._
    `;

    await this.sendToAll(message);
  }

  /**
   * Send a message to all configured chat IDs
   */
  async sendToAll(message) {
    if (!this.isEnabled || !this.bot) return;

    for (const chatId of config.alerts.telegram.chatIds) {
      try {
        await this.bot.sendMessage(chatId.trim(), message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });
      } catch (error) {
        console.error(`[Telegram] ❌ Failed to send to ${chatId}: ${error.message}`);
      }
    }
  }

  /**
   * Send booking confirmation
   */
  async sendBookingConfirmation(bookingData) {
    if (!this.isEnabled) return;

    const message = `
✅ *BOOKING CONFIRMED!* ✅

👤 *Candidate:* ${bookingData.candidateName}
🏙️ *City:* ${bookingData.city}
📅 *Date:* ${bookingData.date}
⏰ *Time:* ${bookingData.time}
🔢 *Ref:* ${bookingData.reference || 'Check email'}

🎉 Appointment booked successfully!
    `;

    await this.sendToAll(message);
  }

  /**
   * Cleanup
   */
  async close() {
    if (this.bot) {
      this.bot.stopPolling();
      console.log('[Telegram] 🛑 Bot stopped');
    }
  }
}

module.exports = TelegramAlerts;
