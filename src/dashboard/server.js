/**
 * Dashboard Server — Real-time web UI for monitoring
 */

const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const http = require('http');
const config = require('../../config');

class DashboardServer {
  constructor(scheduler, patternTracker, candidateStore) {
    this.scheduler = scheduler;
    this.patternTracker = patternTracker;
    this.candidateStore = candidateStore;
    this.app = express();
    this.server = null;
    this.wss = null;
    this.clients = new Set();
  }

  /**
   * Start the dashboard server
   */
  start() {
    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.use(express.json());

    // ── API Routes ──

    // Get current status
    this.app.get('/api/status', (req, res) => {
      res.json(this.scheduler.getStatus());
    });

    // Get intelligence data
    this.app.get('/api/intelligence', (req, res) => {
      res.json(this.patternTracker.getDashboardData());
    });

    // Get candidates (masked)
    this.app.get('/api/candidates', (req, res) => {
      const candidates = this.candidateStore.getAllCandidates();
      // Mask sensitive data for the dashboard
      const masked = candidates.map(c => ({
        id: c.id,
        fullName: c.fullName,
        passport: c.passportNumber ? c.passportNumber.substring(0, 4) + '****' : '',
        city: config.target.cities[c.preferredCity]?.name || c.preferredCity,
        priority: c.priority,
        status: c.bookingStatus,
        jobStartDate: c.jobStartDate,
      }));
      res.json(masked);
    });

    // Get candidate stats
    this.app.get('/api/candidates/stats', (req, res) => {
      res.json(this.candidateStore.getStats());
    });

    // Force check
    this.app.post('/api/force-check', async (req, res) => {
      try {
        const slots = await this.scheduler.forceCheck();
        res.json({ success: true, slotsFound: slots.length, slots });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Pause/Resume
    this.app.post('/api/pause', (req, res) => {
      this.scheduler.pause();
      res.json({ success: true, status: 'paused' });
    });

    this.app.post('/api/resume', async (req, res) => {
      await this.scheduler.resume();
      res.json({ success: true, status: 'running' });
    });

    // Create HTTP server
    this.server = http.createServer(this.app);

    // WebSocket for real-time updates
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      // Send current status on connect
      ws.send(JSON.stringify({
        type: 'status',
        data: this.scheduler.getStatus(),
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });

    // Forward scheduler events to WebSocket clients
    this.scheduler.on('status-update', (data) => {
      this.broadcast({ type: 'status', data });
    });

    this.scheduler.on('slots-found', (data) => {
      this.broadcast({ type: 'slots-found', data });
    });

    this.scheduler.on('no-slots', (data) => {
      this.broadcast({ type: 'no-slots', data });
    });

    this.scheduler.on('check-error', (data) => {
      this.broadcast({ type: 'error', data });
    });

    this.scheduler.on('log', (data) => {
      this.broadcast({ type: 'log', data });
    });

    // Start listening
    this.server.listen(config.dashboard.port, config.dashboard.host, () => {
      console.log(`[Dashboard] 🌐 Running at http://${config.dashboard.host}:${config.dashboard.port}`);
    });
  }

  /**
   * Broadcast a message to all WebSocket clients
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    }
  }

  /**
   * Stop the server
   */
  stop() {
    if (this.server) {
      this.server.close();
      console.log('[Dashboard] 🛑 Server stopped');
    }
  }
}

module.exports = DashboardServer;
