# Bulgaria Type D / New Delhi booking assistant

This project follows `ImplementationPlan.md`: Python + Playwright + Pydantic +
SQLite, with a local desktop dashboard. It validates applicant data, verifies
mapped form fields, monitors authenticated appointment availability within
limits, and requires human action for security steps, payment and final booking.

**Current status:** the engine is implemented and tested against a local booking
simulation. Live VFS selectors are intentionally unconfigured until the actual
Type D / New Delhi pages are inspected. The application refuses to run guessed
selectors. See [plan coverage](docs/PLAN_STATUS.md) and
[page mapping instructions](docs/SELECTOR_MAPPING.md).

## Start

The Python environment and dependencies have already been installed in `.venv`
in this workspace. Run:

```powershell
npm start
```

The dashboard offers **Verify form**, **Find appointment**, and **Inspect pages**.
Start with inspection and form verification. Chrome stays visible during an
active session. Login, CAPTCHA, OTP, identity verification and payment remain
human-controlled. A separate final review compares applicant, passport, route,
appointment and fee before enabling the final submission.

For a fresh installation (Python 3.11+):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m playwright install chromium
npm start
```

The default browser is installed Google Chrome. Set `browser_channel: chromium`
in `config/settings.yaml` to use the Playwright browser instead.

## Applicant and configuration

Copy `examples/applicant.example.json` to `applicant.private.json`, replace the
synthetic values with your own details and validate it before use. The model
requires Indian nationality, Bulgaria Type D, New Delhi, an exact application
category, purpose, contact details and consistent passport/travel dates.

```powershell
.\.venv\Scripts\python.exe main.py validate applicant.private.json
.\.venv\Scripts\python.exe main.py import applicant.private.json
.\.venv\Scripts\python.exe main.py schema
```

Set the desired date range, weekdays and times in `config/appointment_rules.yaml`.
Its application category must exactly match the applicant and the observed VFS
category. Dates in the example configuration are examples, not current availability.

Inspect the live pages and complete `config/selectors.yaml` as described in the
mapping guide. Inspection opens a fresh normal browser; you navigate it manually.

```powershell
npm start -- inspect
npm run check
```

`check` returns exit code 2 while live mapping is incomplete. This is an explicit
readiness result, not an installation failure. No VFS booking action is attempted.

After the mapping has been verified:

```powershell
.\.venv\Scripts\python.exe main.py run APP001 --mode form
.\.venv\Scripts\python.exe main.py run APP001 --mode appointments
```

Form mode stops after filling and verifying the form, before clicking Continue.
Appointment mode requires the form to be verified in the same session, then uses
only the logged-in calendar. Public earliest-available-date hints never qualify
as actual bookable slots. An expired login invalidates the selected applicant
form and appointment state.

Monitoring defaults to a five-minute interval, at most 12 checks per rolling
hour, 30 checks total and a 60-minute session. The configured network retry
budget never exceeds three. HTTP 403/429 or visible restrictions stop the run.
A missing refresh mapping also stops monitoring rather than guessing an action.
Unknown pages pause for inspection. Ambiguous submissions are never retried.

## Local storage

- `data/assistant.sqlite3`: applicants, appointments and event audit. The new
  SQLite database is **not encrypted**. Existing encrypted JavaScript vaults and
  databases are preserved and are not silently migrated.
- `logs/assistant.log`: action and state logs, excluding applicant field values.
- `artifacts/<applicant>/<run>/`: masked-input screenshots, confirmation JSON and
  development trace segments. Tracing is suspended at human/security checkpoints.
  Screenshots can still contain personal details in page text; ordinary form
  traces can contain personal data. Treat all artifacts as private. Set
  `trace: false` for routine use when detailed development diagnostics are not needed.
- `artifacts/inspection/`: locator inventories from manually visited pages.

These paths, `.env`, sessions and `applicant.private.json` are ignored by Git.
This workspace is inside OneDrive; its sync settings also apply to local data.
Credentials and OTPs are not stored by the assistant. There is no mailbox/SMS
reader, CAPTCHA solver, fingerprint spoofing or automatic payment implementation.
Documents, biometrics and possible consular interviews are applicant planning
fields; their actual completion remains part of the human consular process.

## Verify changes

```powershell
npm test
npm run test:relay
```

Python tests use synthetic data and local Playwright pages. They cover validation,
SQLite storage, exact field verification, state detection, route checks, slot
ranking, monitoring limits, human approvals, changed review data, confirmation
capture and browser isolation. They do not log in to VFS or make a real booking.

## Existing JavaScript application

The previous manual Slot Relay remains available explicitly:

```powershell
npm run relay
```

See `SLOT-RELAY.md` for that separate tool. The old stealth monitor, coordinate
form filler, quick launcher and session warmer have been retired. `npm start`
now launches the Python assistant described in the implementation plan.
