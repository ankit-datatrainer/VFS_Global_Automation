/**
 * Pattern Tracker — Analyzes slot detection patterns
 * Identifies when slots typically appear and how fast they get booked
 */

const IntelligenceDB = require('./db');

class PatternTracker {
  constructor() {
    this.db = new IntelligenceDB();
    this.previousSlots = new Set();
  }

  init() {
    this.db.init();
    console.log('[PatternTracker] ✅ Initialized');
  }

  /**
   * Record a check result
   */
  recordCheck(city, slotsFound, slotDates = [], durationMs = 0, error = null) {
    this.db.logCheck(city, slotsFound, slotDates, durationMs, error);

    // Track slot appearances and disappearances
    const currentSlots = new Set(slotDates.map(s => `${city}:${s}`));

    // New slots that appeared
    for (const slot of currentSlots) {
      if (!this.previousSlots.has(slot)) {
        const [slotCity, date] = slot.split(':');
        this.db.logSlotFound(slotCity, date);
      }
    }

    // Slots that disappeared
    for (const slot of this.previousSlots) {
      if (!currentSlots.has(slot)) {
        const [slotCity, date] = slot.split(':');
        this.db.logSlotGone(slotCity, date);
      }
    }

    this.previousSlots = currentSlots;
  }

  /**
   * Get pattern insights as readable text
   */
  getInsights() {
    const hourly = this.db.getHourlyPattern();
    const daily = this.db.getDailyPattern();
    const survival = this.db.getSlotSurvivalTime();
    const stats = this.db.getStats();

    const insights = [];

    // Best hours
    if (hourly.length > 0) {
      const bestHours = hourly
        .filter(h => h.slots_detected > 0)
        .sort((a, b) => b.success_rate - a.success_rate)
        .slice(0, 3);

      if (bestHours.length > 0) {
        insights.push({
          type: 'best_hours',
          title: '🕐 Best Hours for Slot Detection',
          data: bestHours.map(h => `${h.hour}:00 IST — ${h.success_rate}% success rate (${h.slots_detected}/${h.total_checks} checks)`),
        });
      }
    }

    // Best days
    if (daily.length > 0) {
      const bestDays = daily
        .filter(d => d.slots_detected > 0)
        .sort((a, b) => b.success_rate - a.success_rate)
        .slice(0, 3);

      if (bestDays.length > 0) {
        insights.push({
          type: 'best_days',
          title: '📅 Best Days for Slot Detection',
          data: bestDays.map(d => `${d.dayName} — ${d.success_rate}% success rate (${d.slots_detected}/${d.total_checks} checks)`),
        });
      }
    }

    // Slot survival time
    if (survival && survival.total_events > 0) {
      insights.push({
        type: 'survival',
        title: '⏱️ How Fast Slots Get Booked',
        data: [
          `Average: ${this.formatDuration(survival.avg_seconds)}`,
          `Fastest: ${this.formatDuration(survival.min_seconds)}`,
          `Slowest: ${this.formatDuration(survival.max_seconds)}`,
          `Based on ${survival.total_events} slot events`,
        ],
      });
    }

    // Overall stats
    insights.push({
      type: 'overall',
      title: '📊 Overall Statistics',
      data: [
        `Total checks: ${stats.totalChecks}`,
        `Slots detected: ${stats.slotsDetected}`,
        `Success rate: ${stats.successRate}`,
        `Avg check time: ${stats.avgCheckDuration}`,
        `Errors: ${stats.errors}`,
      ],
    });

    return insights;
  }

  /**
   * Get all data for the dashboard API
   */
  getDashboardData() {
    return {
      recentChecks: this.db.getRecentChecks(50),
      hourlyPattern: this.db.getHourlyPattern(),
      dailyPattern: this.db.getDailyPattern(),
      slotSurvival: this.db.getSlotSurvivalTime(),
      stats: this.db.getStats(),
      insights: this.getInsights(),
    };
  }

  /**
   * Format seconds into human-readable duration
   */
  formatDuration(seconds) {
    if (!seconds) return 'N/A';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  }

  close() {
    this.db.close();
  }
}

module.exports = PatternTracker;
