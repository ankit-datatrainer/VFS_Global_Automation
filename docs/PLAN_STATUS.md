# Implementation plan coverage

The default application is now Python + Playwright + Pydantic + SQLite, with a
local Tk dashboard. The previous JavaScript relay is retained separately.

| Plan requirement | Implementation / status |
|---|---|
| Applicant DB and route validation | `applicant/model.py`, `database/db.py`; all ten validation types plus passport issue date |
| Central form mapping and verification | `vfs/mapping.py`, `vfs/form.py`; text/date/select/custom dropdown/checkbox verification |
| State machine and page detection | `vfs/state.py`, `vfs/runner.py`; security overlays take priority |
| Form-only first stage | Default CLI run mode; no form submission in this mode |
| Appointment detector/parser/rules/selector | Separate `appointment/` modules; actual authenticated evidence required |
| EAD vs actual slot | Source distinction; EAD explicitly excluded from ranking |
| Policy monitoring | Session/hour/total check limits, intervals, network retry limits and cooldowns |
| Rate limits and blocks | HTTP 403/429 latch a stop; visible restrictions also stop; no automatic restart |
| Recovery | State changes re-detected; uncertain clicks never replayed; bounded network retries |
| CAPTCHA and identity | Screenshot, local notification, visible browser, human checkpoint, state recheck |
| OTP | Masked local input or direct browser entry; human submission and state recheck |
| Payment and final guard | Full page detail comparison, human approval, recheck for changes, manual payment |
| Confirmation | Reference and approved details verified, JSON/screenshot saved, SQLite updated |
| Browser isolation | Fresh context per applicant/run; no shared cookie or session files |
| Logging and tracing | Action/state audit in logs and SQLite; error screenshots; trace segments outside human/security checkpoints |
| Type D specifics | Separate D model; purpose, category, documents, biometrics and consular interview fields |
| Notifications/dashboard | Local Tk status, attention request, bell, confirm/reject/stop/open-browser controls |
| Security bypass exclusion | Legacy spoofing, coordinate clicking and warm-session code retired |
| Live selector inspection | **Pending**: authenticated Type D/New Delhi pages were not supplied; manual inspection workflow included |
| Actual VFS booking verification | **Pending**: engine tested against local synthetic pages only |

External notification services are optional in the plan; the assistant uses
desktop notification only and sends no email/Telegram messages. Documents,
biometrics and interviews are modeled as planning data, not automatically
performed or claimed complete. They require the actual consular process.

Existing `data/*.db`, encrypted vault records, `.env` and legacy relay functionality
are preserved. They are not silently migrated into the more detailed applicant
schema: importing requires validated JSON with all required fields.
