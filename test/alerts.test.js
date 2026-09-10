/**
 * Test: Alert System — Sends test notifications
 */

require('dotenv').config();

console.log('\n🧪 Testing Alert System...\n');

// Test 1: Sound Player
const SoundPlayer = require('../src/alerts/sound-player');
const soundPlayer = new SoundPlayer();

async function testSound() {
  await soundPlayer.init();
  console.log('✅ Sound player initialized');
  console.log('🔊 Playing test beep...');
  soundPlayer.beep();
  console.log('✅ Beep played');

  // Test success sound
  await new Promise(r => setTimeout(r, 1000));
  console.log('🔊 Playing success sound...');
  soundPlayer.playSuccess();
  console.log('✅ Success sound played');
}

// Test 2: Desktop Notification
const DesktopAlarm = require('../src/alerts/desktop-alarm');
const desktopAlarm = new DesktopAlarm();

function testDesktop() {
  console.log('📢 Sending test desktop notification...');
  desktopAlarm.statusNotification('Test', 'This is a test notification from VFS Slot Hunter');
  console.log('✅ Desktop notification sent');
}

// Test 3: Telegram (only if configured)
const TelegramAlerts = require('../src/alerts/telegram-bot');

async function testTelegram() {
  const telegram = new TelegramAlerts();

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_IDS) {
    console.log('⚠️ Telegram not configured — skipping test');
    console.log('   Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_IDS in .env to test');
    return;
  }

  await telegram.init();
  console.log('📨 Sending test Telegram message...');
  await telegram.sendToAll('🧪 *Test Alert from VFS Slot Hunter*\n\nIf you see this, Telegram alerts are working!');
  console.log('✅ Telegram message sent');

  // Test slot alert format
  await telegram.sendSlotAlert({
    slots: [{ date: '15 Sep 2026' }, { date: '16 Sep 2026' }],
    city: 'New Delhi',
    timestamp: new Date(),
  });
  console.log('✅ Test slot alert sent');

  await telegram.close();
}

async function runTests() {
  await testSound();
  testDesktop();
  await testTelegram();

  console.log('\n✅ All alert tests completed!\n');

  // Wait a bit for async operations to complete
  setTimeout(() => process.exit(0), 3000);
}

runTests().catch(err => {
  console.error(`\n❌ Test failed: ${err.message}`);
  process.exit(1);
});
