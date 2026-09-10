/**
 * Desktop Alarm — Windows system notifications and sound alerts
 */

const notifier = require('node-notifier');
const path = require('path');
const config = require('../../config');

class DesktopAlarm {
  constructor() {
    this.isEnabled = config.alerts.desktop.enabled;
  }

  /**
   * Show a Windows notification for slot found
   */
  slotFoundNotification(slotData) {
    if (!this.isEnabled) return;

    const { slots, city } = slotData;
    const dateList = slots.map(s => s.date).join(', ');

    notifier.notify({
      title: '🚨 VFS SLOT FOUND!',
      message: `${slots.length} slot(s) available in ${city}!\n${dateList}\nClick to open booking page`,
      sound: true,
      wait: true,
      timeout: 30,
      appID: 'VFS Slot Hunter',
    }, (err, response, metadata) => {
      if (err) {
        console.error('[Desktop] ❌ Notification error:', err);
      }
    });

    // The click event opens the booking page
    notifier.on('click', () => {
      const { exec } = require('child_process');
      exec(`start ${config.vfs.bookingUrl}`);
    });
  }

  /**
   * Show a status notification
   */
  statusNotification(title, message) {
    if (!this.isEnabled) return;

    notifier.notify({
      title: `VFS Hunter: ${title}`,
      message: message,
      sound: false,
      timeout: 10,
      appID: 'VFS Slot Hunter',
    });
  }

  /**
   * Show error notification
   */
  errorNotification(message) {
    if (!this.isEnabled) return;

    notifier.notify({
      title: '⚠️ VFS Hunter Error',
      message: message,
      sound: true,
      timeout: 15,
      appID: 'VFS Slot Hunter',
    });
  }
}

module.exports = DesktopAlarm;
