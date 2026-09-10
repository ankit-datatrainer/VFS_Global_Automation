"""Bulgaria Type D assistant: python main.py --help."""
import argparse
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
from tkinter import filedialog, messagebox
from pydantic import ValidationError
from applicant.repository import import_json
from database.db import Database
from ui.dashboard import Dashboard, Cancelled
from vfs.browser import launch
from vfs.mapping import load_mapping
from vfs.runner import Runner
from vfs.settings import ROOT, Rules, Settings, read_yaml
from appointment.monitor import MonitorLimit


def configure_logging():
    folder = ROOT / "logs"
    folder.mkdir(exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(folder / "assistant.log", encoding="utf-8"), logging.StreamHandler()])


def parser():
    cli = argparse.ArgumentParser(description="Bulgaria Type D / New Delhi semi-automated assistant")
    commands = cli.add_subparsers(dest="command")
    imp = commands.add_parser("import", help="Validate applicant JSON and save it locally")
    imp.add_argument("file", type=Path)
    validate = commands.add_parser("validate", help="Validate JSON without opening a browser or saving data")
    validate.add_argument("file", type=Path)
    run = commands.add_parser("run", help="Run an already imported applicant")
    run.add_argument("applicant_id")
    run.add_argument("--mode", choices=["form", "appointments"], default="form")
    run.add_argument("--selectors", type=Path, default=ROOT / "config/selectors.yaml")
    commands.add_parser("check", help="Check configuration and report live selector readiness")
    commands.add_parser("schema", help="Print applicant JSON schema")
    commands.add_parser("inspect", help="Open a manual browser session to capture locator evidence")
    return cli


def execute_run(applicant, mode, selectors, database, ui):
    ui.applicant.set("Applicant: " + applicant.id + " · " + applicant.first_name + " " + applicant.last_name)
    settings = read_yaml(ROOT / "config/settings.yaml", Settings)
    rules = read_yaml(ROOT / "config/appointment_rules.yaml", Rules)
    mapping = load_mapping(selectors).require_live(mode)
    # Everything which can be validated locally is checked before opening VFS.
    from applicant.model import Applicant
    Applicant.model_validate(applicant.model_dump())
    if rules.application_category != applicant.application_category:
        raise ValueError("Applicant and rules must have the same application category")
    if rules.latest_date < datetime.now().date() or rules.earliest_date >= applicant.travel_date:
        raise ValueError("Appointment date range must be current and before travel")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    artifacts = ROOT / "artifacts" / applicant.id / stamp
    with launch(settings, artifacts) as session:
        runner = Runner(session, applicant, mapping, settings, rules, database, ui, mode)
        try:
            session.page.goto(settings.portal_url, wait_until="domcontentloaded")
            return runner.run()
        except Cancelled:
            return "cancelled"
        except Exception as error:
            runner.diagnostic(type(error).__name__)
            # Keep the visible browser open for inspection, but never resume this session.
            message = str(error) if isinstance(error, (ValueError, MonitorLimit)) else type(error).__name__
            try:
                ui.choose("stopped", message, "Inspect the browser. Close this session when finished.\nDiagnostics: " + str(artifacts),
                          [("Close session", "close")], lambda: session.page.wait_for_timeout(100))
            except Cancelled:
                pass
            return "stopped"


def desktop(database):
    ui = Dashboard()
    try:
        ui.update("ready", "Import applicant JSON, then run form verification or the appointment assistant.",
                  "CAPTCHA, login, OTP, identity checks, payment and final booking require you.\n\n"
                  "Type D planning includes documents, biometrics and possible consular interview.\n\n"
                  "Live page mappings must be inspected and verified before browser automation starts.")
        answer, _ = ui.choose("ready", "Choose a workflow", "Start with form verification before monitoring appointments.",
                              [("Verify form", "form"), ("Find appointment", "appointments"), ("Inspect pages", "inspect"), ("Cancel", "cancel")],
                              lambda: ui.root.after(100))
        if answer == "cancel":
            return
        if answer == "inspect":
            from vfs.inspection import inspect_pages
            inspect_pages(read_yaml(ROOT / 'config/settings.yaml', Settings), ROOT / 'artifacts/inspection', ui)
            return
        selected_file = filedialog.askopenfilename(parent=ui.root, title="Choose applicant JSON", filetypes=[("Applicant JSON", "*.json")])
        if not selected_file:
            return
        applicant = import_json(Path(selected_file), database)
        execute_run(applicant, answer, ROOT / "config/selectors.yaml", database, ui)
    except Cancelled:
        pass
    except Exception as error:
        messagebox.showerror("Setup required", safe_error(error), parent=ui.root)
    finally:
        ui.close()


def safe_error(error):
    if isinstance(error, ValidationError):
        return "\n".join(".".join(map(str, e["loc"])) + ": " + e["msg"] for e in error.errors(include_input=False, include_url=False))
    if isinstance(error, ValueError):
        return str(error)
    return f"{type(error).__name__}: check configuration and file access"


def main():
    args = parser().parse_args()
    from applicant.model import Applicant
    if args.command == "schema":
        print(json.dumps(Applicant.model_json_schema(), indent=2))
        return 0
    if args.command == "inspect":
        from vfs.inspection import inspect_pages
        ui = Dashboard()
        try:
            inspect_pages(read_yaml(ROOT / 'config/settings.yaml', Settings), ROOT / 'artifacts/inspection', ui)
        except Cancelled:
            pass
        finally:
            ui.close()
        return 0
    if args.command == "validate":
        applicant = Applicant.model_validate_json(args.file.read_text(encoding="utf-8-sig"))
        print("Applicant validated: " + applicant.id)
        return 0
    if args.command == "check":
        read_yaml(ROOT / "config/settings.yaml", Settings)
        read_yaml(ROOT / "config/appointment_rules.yaml", Rules)
        mapping = load_mapping(ROOT / "config/selectors.yaml")
        print("Configuration valid; Python + Playwright + Pydantic + SQLite ready.")
        try:
            mapping.require_live()
        except ValueError as error:
            print("Live mapping pending: " + str(error))
            return 2
        print("Live mapping is marked verified. Run form-only verification first.")
        return 0
    configure_logging()
    database = Database(ROOT / "data/assistant.sqlite3")
    try:
        if args.command == "import":
            applicant = import_json(args.file, database)
            print("Applicant saved: " + applicant.id)
        elif args.command == "run":
            applicant = database.load_applicant(args.applicant_id)
            ui = Dashboard()
            try:
                outcome = execute_run(applicant, args.mode, args.selectors, database, ui)
                print("Session result: " + outcome)
                return 0 if outcome in ("form_verified", "confirmed", "cancelled") else 1
            finally:
                ui.close()
        else:
            desktop(database)
    finally:
        database.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        print(safe_error(error))
        raise SystemExit(1)
