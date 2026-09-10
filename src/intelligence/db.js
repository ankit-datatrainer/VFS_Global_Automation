/**
 * Intelligence DB — SQLite setup for slot pattern tracking
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../../config');

class IntelligenceDB {
  constructor() {
    this.db = null;
  }

  init() {
    const dataDir = path.resolve(config.paths.data);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.resolve(config.paths.intelligenceDb);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS check_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        city TEXT NOT NULL,
        slots_found INTEGER DEFAULT 0,
        slot_dates TEXT,
        check_duration_ms INTEGER,
        error TEXT,
        day_of_week INTEGER,
        hour_of_day INTEGER
      );

      CREATE TABLE IF NOT EXISTS slot_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        city TEXT NOT NULL,
        date_found TEXT NOT NULL,
        gone_at DATETIME,
        duration_seconds INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_check_log_time ON check_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_check_log_city ON check_log(city);
      CREATE INDEX IF NOT EXISTS idx_slot_events_city ON slot_events(city);
    `);

    console.log('[IntelligenceDB] ✅ Database initialized');
  }

  /**
   * Log a check result
   */
  logCheck(city, slotsFound, slotDates = [], durationMs = 0, error = null) {
    const now = new Date();
    const istHour = parseInt(now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
    const dayOfWeek = now.getDay();

    this.db.prepare(`
      INSERT INTO check_log (city, slots_found, slot_dates, check_duration_ms, error, day_of_week, hour_of_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(city, slotsFound, JSON.stringify(slotDates), durationMs, error, dayOfWeek, istHour);
  }

  /**
   * Log a slot appearance
   */
  logSlotFound(city, dateFound) {
    // Check if this slot was already recorded (within last hour)
    const existing = this.db.prepare(`
      SELECT id FROM slot_events 
      WHERE city = ? AND date_found = ? AND gone_at IS NULL
      AND timestamp > datetime('now', '-1 hour')
    `).get(city, dateFound);

    if (!existing) {
      this.db.prepare(`
        INSERT INTO slot_events (city, date_found) VALUES (?, ?)
      `).run(city, dateFound);
    }
  }

  /**
   * Mark a slot as gone
   */
  logSlotGone(city, dateFound) {
    this.db.prepare(`
      UPDATE slot_events 
      SET gone_at = CURRENT_TIMESTAMP,
          duration_seconds = CAST((julianday(CURRENT_TIMESTAMP) - julianday(timestamp)) * 86400 AS INTEGER)
      WHERE city = ? AND date_found = ? AND gone_at IS NULL
    `).run(city, dateFound);
  }

  /**
   * Get recent check history
   */
  getRecentChecks(limit = 100) {
    return this.db.prepare(`
      SELECT * FROM check_log ORDER BY timestamp DESC LIMIT ?
    `).all(limit);
  }

  /**
   * Get slot frequency by hour of day
   */
  getHourlyPattern() {
    return this.db.prepare(`
      SELECT 
        hour_of_day as hour,
        SUM(CASE WHEN slots_found > 0 THEN 1 ELSE 0 END) as slots_detected,
        COUNT(*) as total_checks,
        ROUND(100.0 * SUM(CASE WHEN slots_found > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as success_rate
      FROM check_log
      GROUP BY hour_of_day
      ORDER BY hour_of_day
    `).all();
  }

  /**
   * Get slot frequency by day of week
   */
  getDailyPattern() {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const results = this.db.prepare(`
      SELECT 
        day_of_week,
        SUM(CASE WHEN slots_found > 0 THEN 1 ELSE 0 END) as slots_detected,
        COUNT(*) as total_checks,
        ROUND(100.0 * SUM(CASE WHEN slots_found > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as success_rate
      FROM check_log
      GROUP BY day_of_week
      ORDER BY day_of_week
    `).all();

    return results.map(r => ({
      ...r,
      dayName: dayNames[r.day_of_week],
    }));
  }

  /**
   * Get average slot survival time (how fast they get booked)
   */
  getSlotSurvivalTime() {
    const result = this.db.prepare(`
      SELECT 
        AVG(duration_seconds) as avg_seconds,
        MIN(duration_seconds) as min_seconds,
        MAX(duration_seconds) as max_seconds,
        COUNT(*) as total_events
      FROM slot_events
      WHERE gone_at IS NOT NULL
    `).get();

    return result;
  }

  /**
   * Get overall statistics
   */
  getStats() {
    const totalChecks = this.db.prepare('SELECT COUNT(*) as count FROM check_log').get().count;
    const slotsDetected = this.db.prepare('SELECT COUNT(*) as count FROM check_log WHERE slots_found > 0').get().count;
    const errors = this.db.prepare('SELECT COUNT(*) as count FROM check_log WHERE error IS NOT NULL').get().count;
    const avgDuration = this.db.prepare('SELECT AVG(check_duration_ms) as avg FROM check_log WHERE error IS NULL').get().avg;

    return {
      totalChecks,
      slotsDetected,
      errors,
      avgCheckDuration: avgDuration ? (avgDuration / 1000).toFixed(1) + 's' : '0s',
      successRate: totalChecks > 0 ? ((slotsDetected / totalChecks) * 100).toFixed(2) + '%' : '0%',
    };
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = IntelligenceDB;
