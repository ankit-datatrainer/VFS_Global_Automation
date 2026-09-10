/**
 * Sound Player — Loud alarm that cuts through everything
 * Plays a persistent alarm when slots are detected
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../../config');

class SoundPlayer {
  constructor() {
    this.isEnabled = config.alerts.sound.enabled;
    this.isPlaying = false;
    this.process = null;
    this.soundDir = path.resolve(config.paths.sounds);
  }

  /**
   * Initialize — create alarm sound if it doesn't exist
   */
  async init() {
    // Ensure sounds directory exists
    if (!fs.existsSync(this.soundDir)) {
      fs.mkdirSync(this.soundDir, { recursive: true });
    }

    // Generate a WAV alarm sound programmatically if none exists
    const alarmPath = path.join(this.soundDir, 'alarm.wav');
    if (!fs.existsSync(alarmPath)) {
      this.generateAlarmWav(alarmPath);
      console.log('[Sound] ✅ Generated alarm sound file');
    }
  }

  /**
   * Generate a simple WAV alarm tone
   */
  generateAlarmWav(filePath) {
    const sampleRate = 44100;
    const duration = 3; // 3 seconds
    const frequency1 = 880; // A5 note (piercing)
    const frequency2 = 1760; // A6 note (higher pitch)
    const numSamples = sampleRate * duration;
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numSamples * blockAlign;
    const fileSize = 36 + dataSize;

    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;

    // RIFF header
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;

    // fmt chunk
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4; // chunk size
    buffer.writeUInt16LE(1, offset); offset += 2;  // PCM
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(sampleRate * blockAlign, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

    // data chunk
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;

    // Generate alternating siren tone
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Alternate between two frequencies every 0.5 seconds (siren effect)
      const freq = Math.floor(t * 2) % 2 === 0 ? frequency1 : frequency2;
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.8;
      const value = Math.max(-1, Math.min(1, sample)) * 32767;
      buffer.writeInt16LE(Math.round(value), offset);
      offset += 2;
    }

    fs.writeFileSync(filePath, buffer);
  }

  /**
   * Play the alarm sound (loops until stopped)
   */
  playAlarm() {
    if (!this.isEnabled || this.isPlaying) return;

    const alarmPath = path.join(this.soundDir, 'alarm.wav');
    if (!fs.existsSync(alarmPath)) {
      console.error('[Sound] ❌ Alarm file not found');
      return;
    }

    this.isPlaying = true;
    console.log('[Sound] 🔊 ALARM PLAYING — solve CAPTCHA to stop');

    // On Windows, use PowerShell to play sound in a loop
    this.playLoop(alarmPath);
  }

  /**
   * Play sound in a loop using Windows Media Player COM object
   */
  playLoop(soundFile) {
    if (!this.isPlaying) return;

    const cmd = `powershell -Command "(New-Object Media.SoundPlayer '${soundFile.replace(/'/g, "''")}').PlaySync()"`;

    this.process = exec(cmd, (error) => {
      if (this.isPlaying) {
        // Loop: play again
        this.playLoop(soundFile);
      }
    });
  }

  /**
   * Stop the alarm
   */
  stopAlarm() {
    this.isPlaying = false;

    if (this.process) {
      try {
        // Kill the sound process on Windows
        exec(`taskkill /PID ${this.process.pid} /F /T`, () => { });
      } catch (e) { }
      this.process = null;
    }

    console.log('[Sound] 🔇 Alarm stopped');
  }

  /**
   * Play a single beep (for non-critical notifications)
   */
  beep() {
    if (!this.isEnabled) return;

    // Windows system beep
    exec('powershell -Command "[console]::beep(1000,300)"');
  }

  /**
   * Play a success sound
   */
  playSuccess() {
    if (!this.isEnabled) return;

    exec('powershell -Command "[console]::beep(800,200); Start-Sleep -Milliseconds 100; [console]::beep(1200,200); Start-Sleep -Milliseconds 100; [console]::beep(1600,300)"');
  }
}

module.exports = SoundPlayer;
