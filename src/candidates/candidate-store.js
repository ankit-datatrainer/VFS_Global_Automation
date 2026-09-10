/**
 * Candidate Store — Encrypted local database for candidate details
 * Uses AES-256-GCM encryption for all sensitive data (passport, credentials)
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const config = require('../../config');

class CandidateStore {
  constructor() {
    this.db = null;
    this.encryptionKey = null;
  }

  /**
   * Initialize the database and derive encryption key
   */
  init() {
    // Ensure data directory exists
    const dataDir = path.resolve(config.paths.data);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Derive encryption key from master password
    const salt = this.getOrCreateSalt(dataDir);
    this.encryptionKey = crypto.pbkdf2Sync(
      config.encryption.masterPassword,
      salt,
      config.encryption.iterations,
      config.encryption.keyLength,
      'sha512'
    );

    // Open SQLite database
    const dbPath = path.resolve(config.paths.candidateDb);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        passport_number_enc TEXT NOT NULL,
        date_of_birth_enc TEXT NOT NULL,
        nationality TEXT DEFAULT 'Indian',
        email_enc TEXT NOT NULL,
        phone_enc TEXT,
        visa_category TEXT DEFAULT 'national_visa',
        preferred_city TEXT DEFAULT 'delhi',
        priority INTEGER DEFAULT 5,
        job_start_date TEXT,
        vfs_email_enc TEXT,
        vfs_password_enc TEXT,
        notes TEXT,
        booking_status TEXT DEFAULT 'pending',
        booking_date TEXT,
        booking_reference TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS booking_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER REFERENCES candidates(id),
        action TEXT NOT NULL,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('[CandidateStore] ✅ Database initialized');
  }

  /**
   * Get or create the encryption salt
   */
  getOrCreateSalt(dataDir) {
    const saltPath = path.join(dataDir, '.salt');
    if (fs.existsSync(saltPath)) {
      return fs.readFileSync(saltPath);
    }
    const salt = crypto.randomBytes(config.encryption.saltLength);
    fs.writeFileSync(saltPath, salt);
    return salt;
  }

  /**
   * Encrypt a string value
   */
  encrypt(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(config.encryption.ivLength);
    const cipher = crypto.createCipheriv(config.encryption.algorithm, this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    // Format: iv:tag:encrypted
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt a string value
   */
  decrypt(encryptedText) {
    if (!encryptedText) return '';
    try {
      const [ivHex, tagHex, encrypted] = encryptedText.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const decipher = crypto.createDecipheriv(config.encryption.algorithm, this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('[CandidateStore] ❌ Decryption failed — wrong master password?');
      return '[DECRYPTION FAILED]';
    }
  }

  /**
   * Add a new candidate
   */
  addCandidate(data) {
    const stmt = this.db.prepare(`
      INSERT INTO candidates (
        full_name, passport_number_enc, date_of_birth_enc,
        nationality, email_enc, phone_enc, visa_category,
        preferred_city, priority, job_start_date,
        vfs_email_enc, vfs_password_enc, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.fullName,
      this.encrypt(data.passportNumber),
      this.encrypt(data.dateOfBirth),
      data.nationality || 'Indian',
      this.encrypt(data.email),
      this.encrypt(data.phone || ''),
      data.visaCategory || 'national_visa',
      data.preferredCity || 'delhi',
      data.priority || 5,
      data.jobStartDate || null,
      this.encrypt(data.vfsEmail || ''),
      this.encrypt(data.vfsPassword || ''),
      data.notes || ''
    );

    this.logAction(result.lastInsertRowid, 'added', 'Candidate added to database');
    console.log(`[CandidateStore] ✅ Added candidate: ${data.fullName} (ID: ${result.lastInsertRowid})`);
    return result.lastInsertRowid;
  }

  /**
   * Get a candidate by ID (decrypted)
   */
  getCandidate(id) {
    const row = this.db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
    if (!row) return null;
    return this.decryptCandidate(row);
  }

  /**
   * Get all candidates (with sensitive data decrypted)
   */
  getAllCandidates() {
    const rows = this.db.prepare('SELECT * FROM candidates ORDER BY priority ASC, created_at ASC').all();
    return rows.map(row => this.decryptCandidate(row));
  }

  /**
   * Get candidates for a specific city
   */
  getCandidatesByCity(city) {
    const rows = this.db.prepare('SELECT * FROM candidates WHERE preferred_city = ? AND booking_status = ? ORDER BY priority ASC').all(city, 'pending');
    return rows.map(row => this.decryptCandidate(row));
  }

  /**
   * Get the highest priority pending candidate for a city
   */
  getNextCandidate(city) {
    const row = this.db.prepare('SELECT * FROM candidates WHERE preferred_city = ? AND booking_status = ? ORDER BY priority ASC LIMIT 1').get(city, 'pending');
    if (!row) return null;
    return this.decryptCandidate(row);
  }

  /**
   * Update booking status
   */
  updateBookingStatus(id, status, reference = null, date = null) {
    this.db.prepare(`
      UPDATE candidates 
      SET booking_status = ?, booking_reference = ?, booking_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, reference, date, id);

    this.logAction(id, 'status_updated', `Status changed to: ${status}`);
  }

  /**
   * Update candidate data
   */
  updateCandidate(id, data) {
    const updates = [];
    const values = [];

    if (data.fullName !== undefined) { updates.push('full_name = ?'); values.push(data.fullName); }
    if (data.passportNumber !== undefined) { updates.push('passport_number_enc = ?'); values.push(this.encrypt(data.passportNumber)); }
    if (data.dateOfBirth !== undefined) { updates.push('date_of_birth_enc = ?'); values.push(this.encrypt(data.dateOfBirth)); }
    if (data.email !== undefined) { updates.push('email_enc = ?'); values.push(this.encrypt(data.email)); }
    if (data.phone !== undefined) { updates.push('phone_enc = ?'); values.push(this.encrypt(data.phone)); }
    if (data.preferredCity !== undefined) { updates.push('preferred_city = ?'); values.push(data.preferredCity); }
    if (data.priority !== undefined) { updates.push('priority = ?'); values.push(data.priority); }
    if (data.vfsEmail !== undefined) { updates.push('vfs_email_enc = ?'); values.push(this.encrypt(data.vfsEmail)); }
    if (data.vfsPassword !== undefined) { updates.push('vfs_password_enc = ?'); values.push(this.encrypt(data.vfsPassword)); }
    if (data.notes !== undefined) { updates.push('notes = ?'); values.push(data.notes); }

    if (updates.length === 0) return;

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    this.db.prepare(`UPDATE candidates SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    this.logAction(id, 'updated', 'Candidate details updated');
  }

  /**
   * Delete a candidate
   */
  deleteCandidate(id) {
    // Delete related booking history first (FK constraint)
    this.db.prepare('DELETE FROM booking_history WHERE candidate_id = ?').run(id);
    this.db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
    console.log(`[CandidateStore] 🗑️ Deleted candidate ID: ${id}`);
  }

  /**
   * Decrypt a candidate row
   */
  decryptCandidate(row) {
    return {
      id: row.id,
      fullName: row.full_name,
      passportNumber: this.decrypt(row.passport_number_enc),
      dateOfBirth: this.decrypt(row.date_of_birth_enc),
      nationality: row.nationality,
      email: this.decrypt(row.email_enc),
      phone: this.decrypt(row.phone_enc),
      visaCategory: row.visa_category,
      preferredCity: row.preferred_city,
      priority: row.priority,
      jobStartDate: row.job_start_date,
      vfsEmail: this.decrypt(row.vfs_email_enc),
      vfsPassword: this.decrypt(row.vfs_password_enc),
      notes: row.notes,
      bookingStatus: row.booking_status,
      bookingDate: row.booking_date,
      bookingReference: row.booking_reference,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Log an action in booking history
   */
  logAction(candidateId, action, details) {
    this.db.prepare('INSERT INTO booking_history (candidate_id, action, details) VALUES (?, ?, ?)').run(candidateId, action, details);
  }

  /**
   * Get booking history for a candidate
   */
  getHistory(candidateId) {
    return this.db.prepare('SELECT * FROM booking_history WHERE candidate_id = ? ORDER BY timestamp DESC').all(candidateId);
  }

  /**
   * Get summary stats
   */
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM candidates').get().count;
    const pending = this.db.prepare('SELECT COUNT(*) as count FROM candidates WHERE booking_status = ?').get('pending').count;
    const booked = this.db.prepare('SELECT COUNT(*) as count FROM candidates WHERE booking_status = ?').get('booked').count;
    const byCity = this.db.prepare(`
      SELECT preferred_city as city, COUNT(*) as count 
      FROM candidates WHERE booking_status = 'pending'
      GROUP BY preferred_city
    `).all();

    return { total, pending, booked, byCity };
  }

  /**
   * Close database
   */
  close() {
    if (this.db) {
      this.db.close();
      console.log('[CandidateStore] 🛑 Database closed');
    }
  }
}

module.exports = CandidateStore;
