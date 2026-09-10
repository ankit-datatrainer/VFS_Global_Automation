import json
from pathlib import Path
import sqlite3
from datetime import datetime, timezone
from applicant.model import Applicant


def now():
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.executescript("""
          CREATE TABLE IF NOT EXISTS applicant (
            id TEXT PRIMARY KEY, first_name TEXT, middle_name TEXT, last_name TEXT,
            date_of_birth TEXT, place_of_birth TEXT, nationality TEXT,
            passport_number TEXT, passport_issue_date TEXT, passport_expiry_date TEXT,
            email TEXT, phone TEXT, address TEXT, visa_type TEXT, purpose TEXT,
            travel_date TEXT, vfs_centre TEXT, status TEXT, payload TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS appointment (
            id INTEGER PRIMARY KEY, applicant_id TEXT NOT NULL REFERENCES applicant(id),
            centre TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
            status TEXT NOT NULL, detected_at TEXT NOT NULL, selected_at TEXT,
            confirmation_reference TEXT,
            UNIQUE(applicant_id, centre, date, time));
          CREATE TABLE IF NOT EXISTS event (
            id INTEGER PRIMARY KEY, applicant_id TEXT, state TEXT, action TEXT,
            recorded_at TEXT NOT NULL);
        """)

    def save_applicant(self, applicant):
        payload = applicant.model_dump(mode="json")
        columns = [r[1] for r in self.connection.execute("PRAGMA table_info(applicant)")]
        values = {k: payload[k] for k in columns if k in payload}
        values.update(payload=json.dumps(payload), created_at=now(), updated_at=now())
        fields = list(values)
        updates = ','.join(f'{k}=excluded.{k}' for k in fields if k not in ('id', 'created_at'))
        with self.connection:
            self.connection.execute(
                f"INSERT INTO applicant ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)}) "
                f"ON CONFLICT(id) DO UPDATE SET {updates}", list(values.values()))

    def load_applicant(self, applicant_id):
        row = self.connection.execute("SELECT payload FROM applicant WHERE id=?", (applicant_id,)).fetchone()
        if not row:
            raise ValueError("Applicant ID not found")
        return Applicant.model_validate_json(row['payload'])

    def event(self, applicant_id, state, action):
        with self.connection:
            self.connection.execute("INSERT INTO event(applicant_id,state,action,recorded_at) VALUES(?,?,?,?)",
                                    (applicant_id, state, action, now()))

    def record_slot(self, applicant_id, slot, status="detected", reference=None):
        with self.connection:
            self.connection.execute("""
              INSERT INTO appointment(applicant_id,centre,date,time,status,detected_at,selected_at,confirmation_reference)
              VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(applicant_id,centre,date,time) DO UPDATE SET
              status=CASE WHEN appointment.status='confirmed' THEN 'confirmed' ELSE excluded.status END,
              selected_at=COALESCE(appointment.selected_at,excluded.selected_at),
              confirmation_reference=COALESCE(excluded.confirmation_reference,appointment.confirmation_reference)
            """, (applicant_id, slot.centre, slot.date.isoformat(), slot.time.isoformat(), status,
                  now(), now() if status == "selected" else None, reference))

    def close(self):
        self.connection.close()
