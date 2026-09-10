/**
 * Loud local alarm. Repeats until acknowledged.
 *
 * Uses OS-native audio so there is no npm dependency:
 *   Windows — PowerShell SoundPlayer for a wav, Console.Beep as fallback
 *   macOS   — afplay / say
 *   Linux   — paplay / aplay / terminal bell
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import config from '../config.js';

const PLATFORM = os.platform();
const CUSTOM_WAV = path.join(config.root, 'sounds', 'alarm.wav');

let active = null;

function beepWindows() {
  // Rising three-tone pattern — deliberately unlike any normal notification.
  const script = '[console]::beep(880,220); [console]::beep(1175,220); [console]::beep(1568,420)';
  return spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function playFileWindows(file) {
  const script = `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`;
  return spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function playOnce() {
  try {
    if (PLATFORM === 'win32') {
      return fs.existsSync(CUSTOM_WAV) ? playFileWindows(CUSTOM_WAV) : beepWindows();
    }
    if (PLATFORM === 'darwin') {
      const file = fs.existsSync(CUSTOM_WAV) ? CUSTOM_WAV : '/System/Library/Sounds/Sosumi.aiff';
      return spawn('afplay', [file], { stdio: 'ignore' });
    }
    for (const [bin, args] of [
      ['paplay', [CUSTOM_WAV]],
      ['aplay', [CUSTOM_WAV]],
    ]) {
      if (fs.existsSync(CUSTOM_WAV)) return spawn(bin, args, { stdio: 'ignore' });
    }
    process.stdout.write('\x07');
  } catch {
    process.stdout.write('\x07');
  }
  return null;
}

/** Start the repeating alarm. Returns a stop function. */
export function raise(label = 'SLOT') {
  if (!config.alarm.enabled) return () => {};
  stop();

  let count = 0;
  const banner = `\n${'='.repeat(58)}\n  ${label}\n  Press Enter in this window to silence.\n${'='.repeat(58)}\n`;
  process.stdout.write(banner);

  const tick = () => {
    if (count >= config.alarm.maxRepeats) return stop();
    count++;
    playOnce();
  };
  tick();
  const timer = setInterval(tick, config.alarm.repeatGapMs);
  active = { timer };
  return stop;
}

export function stop() {
  if (active?.timer) clearInterval(active.timer);
  active = null;
}

export function isRinging() {
  return active !== null;
}

/** Wire Enter-to-silence on the controlling terminal. */
export function attachAcknowledgeKey() {
  if (!process.stdin.isTTY) return;
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', () => {
    if (isRinging()) {
      stop();
      console.log('  Alarm acknowledged.\n');
    }
  });
}
