"""State-driven assistant. Non-idempotent submissions are never retried."""
import json
import logging
import time
from datetime import date
from urllib.parse import urlsplit
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from applicant.model import Applicant
from appointment.detector import appointment_ready
from appointment.monitor import MonitorBudget, MonitorLimit
from appointment.parser import parse_slots, route_evidence
from appointment.rules import rank_slots
from appointment.selector import select_slot
from ui.dashboard import Cancelled
from vfs.confirmation import review_snapshot, save_confirmation
from vfs.form import fill_form, write_and_verify
from vfs.mapping import unique
from vfs.state import VFSState, SECURITY_STATES, detect_state


class StateChanged(RuntimeError):
    pass


class Runner:
    def __init__(self, session, applicant, mapping, settings, rules, database, ui, mode="appointments"):
        self.session, self.page, self.applicant = session, session.page, applicant
        self.mapping, self.settings, self.rules = mapping, settings, rules
        self.database, self.ui, self.mode = database, ui, mode
        self.budget = MonitorBudget(settings.monitor)
        self.selected = None
        self.approved = None
        self.form_verified = False
        self.last_state = None
        self.rejected = set()
        self.submission_attempted = False
        self.ui.open_browser = self.page.bring_to_front

    def log(self, action):
        state = self.last_state or VFSState.START
        logging.getLogger("vfs").info("applicant=%s state=%s action=%s", self.applicant.id, state, action)
        self.database.event(self.applicant.id, str(state), action)

    def state(self):
        return detect_state(self.page, self.mapping, self.session.blocked)

    def tick(self):
        self.budget.check_session()
        if self.session.blocked or self.state() == VFSState.BLOCKED:
            self.session.blocked = True
            raise MonitorLimit("VFS returned a restriction; stop and review before starting another session")
        self.ui.update()
        self.page.wait_for_timeout(100)  # Local event pumping, never a site refresh.

    def guard(self, expected):
        self.budget.check_session()
        current = self.state()
        if current == VFSState.BLOCKED:
            raise MonitorLimit("Rate limit or security restriction; human review required")
        if current != expected:
            raise StateChanged("Page changed before the next action")

    def checkpoint(self, state, message, details="", options=None, otp=False):
        self.session.set_tracing(False)
        self.log("human checkpoint")
        answer, code = self.ui.choose(state, message, details,
                                     options or [("Continue", "continue"), ("Cancel", "cancel")], self.tick, otp)
        if answer == "cancel":
            raise Cancelled("Cancelled at human checkpoint")
        return answer, code

    def click_transition(self, action, expected):
        self.guard(expected)
        spec = self.mapping.actions.get(action)
        if not spec:
            raise ValueError("Missing observed navigation mapping: " + action)
        # Never repeat an uncertain click automatically.
        self.log("click " + action)
        try:
            unique(spec, self.page).click()
        except PlaywrightTimeout as error:
            raise ValueError("Navigation click outcome is uncertain; inspect manually. It will not be retried.") from error
        deadline = time.monotonic() + self.settings.action_timeout_ms / 1000
        while self.state() == expected and time.monotonic() < deadline:
            self.tick()
        if self.state() == expected:
            raise ValueError("Navigation was not verified after " + action + "; inspect the browser before continuing")

    def human_security(self, state):
        self.session.screenshot(state.value)
        self.page.bring_to_front()
        detail = "Complete this step in the visible browser, then press Continue."
        if state == VFSState.PAYMENT:
            snapshot = review_snapshot(self.page, self.mapping, self.applicant, self.selected)
            if not self.approved or snapshot != self.approved:
                raise ValueError("Payment details differ from the final booking approval")
            detail = json.dumps(snapshot, indent=2) + "\n\nComplete payment and authentication in the browser."
        _, code = self.checkpoint(state, "Human action required", detail, otp=state == VFSState.OTP)
        if code:
            self.guard(VFSState.OTP)
            if not self.mapping.otp:
                raise ValueError("OTP input is not mapped; enter the code in the browser")
            if not code.isdigit() or not 4 <= len(code) <= 10:
                raise ValueError("OTP must contain 4 to 10 digits")
            unique(self.mapping.otp, self.page).fill(code)
            code = ""
            # Human submits OTP in VFS. It is never logged or saved by the application.
        if self.state() == state:
            self.ui.update(message="The challenge is still present. Complete it in the browser.")

    def check_appointments(self):
        if not self.form_verified:
            raise ValueError("Applicant form has not been filled and verified in this session")
        if not appointment_ready(self.page, self.mapping, self.rules):
            raise StateChanged("Appointment page changed")
        delay = self.budget.delay()
        if delay:
            self.ui.update(VFSState.APPOINTMENT, f"Next availability check in {int(delay) + 1} seconds")
            self.tick()
            return
        self.budget.begin_check()
        if self.budget.checks > 1:
            # Only an explicitly mapped, legitimate availability refresh control is used.
            refresh = self.mapping.actions.get("refresh_availability")
            if not refresh:
                raise MonitorLimit("No observed availability refresh control; inspect the calendar manually")
            self.guard(VFSState.APPOINTMENT)
            unique(refresh, self.page).click()
            self.guard(VFSState.APPOINTMENT)
        if self.session.network_failure:
            self.session.network_failure = False
            self.budget.network_error()
            self.log("network error; availability cooldown")
            return
        slots = parse_slots(self.page, self.mapping, self.rules)
        self.log("availability check completed")
        for slot in slots:
            self.database.record_slot(self.applicant.id, slot)
        valid = [s for s in rank_slots(slots, self.rules, self.applicant.travel_date)
                 if (s.date, s.time) not in self.rejected]
        self.budget.success()
        if not valid:
            self.ui.update(VFSState.APPOINTMENT, "No matching appointment found. Monitoring within configured limits.")
            if not self.settings.monitor.enabled:
                raise MonitorLimit("Single availability check complete")
            return
        candidate = valid[0]
        answer, _ = self.checkpoint(VFSState.APPOINTMENT, "Matching appointment found",
                                    candidate.model_dump_json(indent=2),
                                    [("Select appointment", "confirm"), ("Reject", "reject"), ("Cancel", "cancel")])
        self.guard(VFSState.APPOINTMENT)
        if answer == "reject":
            self.rejected.add((candidate.date, candidate.time))
            self.database.record_slot(self.applicant.id, candidate, "rejected")
            return
        select_slot(self.page, self.mapping, self.rules, candidate)
        self.selected = candidate
        self.approved = None
        self.database.record_slot(self.applicant.id, candidate, "selected")
        self.click_transition("appointment_next", VFSState.APPOINTMENT)

    def run(self):
        # Revalidate on every run, including stored applicants whose dates can expire.
        Applicant.model_validate(self.applicant.model_dump())
        self.mapping.require_live(self.mode)
        if self.rules.application_category != self.applicant.application_category:
            raise ValueError("Applicant and appointment rules specify different categories")
        if self.rules.latest_date < date.today():
            raise ValueError("Appointment date range has expired")
        if self.rules.earliest_date >= self.applicant.travel_date:
            raise ValueError("Appointment range must start before travel")
        self.log("session started")
        while True:
            try:
                self.budget.check_session()
                state = self.state()
                self.session.set_tracing(self.settings.trace and state in {
                    VFSState.DASHBOARD, VFSState.APPLICATION, VFSState.FORM, VFSState.APPOINTMENT})
                if state != self.last_state:
                    self.last_state = state
                    self.log("page state detected")
                    self.ui.update(state)
                if state == VFSState.BLOCKED:
                    self.session.blocked = True
                    raise MonitorLimit("VFS restriction detected; session stopped for human review")
                if state == VFSState.LOGIN:
                    self.form_verified = False
                    self.selected = self.approved = None
                    self.checkpoint(state, "Log in using the visible browser", "Credentials stay in the browser. Then press Continue.")
                elif state in SECURITY_STATES:
                    self.human_security(state)
                elif state == VFSState.DASHBOARD:
                    self.click_transition("dashboard_next", state)
                elif state == VFSState.APPLICATION:
                    for choice in self.mapping.route_choices:
                        self.guard(state)
                        write_and_verify(self.page, choice.field, choice.value)
                    self.click_transition("application_next", state)
                elif state == VFSState.FORM:
                    route_evidence(self.page, self.mapping, self.rules)
                    fill_form(self.page, self.applicant, self.mapping, lambda: self.guard(state), self.log)
                    self.form_verified = True
                    if self.mode == "form":
                        self.checkpoint(state, "All mapped applicant fields are verified", "Form-only mode is complete. The form has not been submitted.", [("Finish", "finish")])
                        return "form_verified"
                    self.click_transition("form_next", state)
                elif state == VFSState.APPOINTMENT:
                    self.check_appointments()
                elif state == VFSState.REVIEW:
                    snapshot = review_snapshot(self.page, self.mapping, self.applicant, self.selected)
                    self.checkpoint(state, "FINAL BOOKING REVIEW — verify every detail", json.dumps(snapshot, indent=2),
                                    [("Confirm booking", "confirm"), ("Cancel", "cancel")])
                    self.guard(state)
                    if review_snapshot(self.page, self.mapping, self.applicant, self.selected) != snapshot:
                        raise ValueError("Booking details changed during review; approval invalidated")
                    if self.submission_attempted:
                        raise ValueError("Submission already attempted; inspect the booking manually")
                    self.approved = snapshot
                    self.submission_attempted = True
                    self.click_transition("review_submit", state)
                elif state == VFSState.CONFIRMATION:
                    path = save_confirmation(self.session, self.mapping, self.applicant, self.selected, self.approved, self.database)
                    self.log("confirmation saved")
                    self.checkpoint(state, "Booking confirmation saved", str(path), [("Finish", "finish")])
                    return "confirmed"
                else:
                    self.session.screenshot(state.value)
                    self.checkpoint(state, "Page needs human inspection", "Navigate to a recognized page or stop and update the observed mapping.")
                self.tick()
            except StateChanged:
                self.approved = None
                continue
            except PlaywrightTimeout:
                # A timeout can mean the server accepted an action; do not replay it.
                self.diagnostic("TimeoutError")
                self.checkpoint(VFSState.ERROR, "Action timed out; inspect the browser", "The action will not be retried. Verify the current page before continuing.")
            except (MonitorLimit, Cancelled):
                raise
            except Exception as error:
                self.approved = None
                self.diagnostic(type(error).__name__)
                raise

    def diagnostic(self, error_type):
        self.session.set_tracing(False)
        # Do not log page contents, credentials, URL query strings or exception values.
        url = urlsplit(self.page.url)
        logging.getLogger("vfs").error("state=%s action=inspection exception=%s origin=%s://%s",
                                       self.last_state, error_type, url.scheme, url.netloc)
        try:
            self.session.screenshot("error")
        except Exception:
            logging.getLogger("vfs").error("Error screenshot unavailable")
