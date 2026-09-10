import json
import pytest
from appointment.parser import parse_slots
from appointment.selector import select_slot
from database.db import Database
from ui.dashboard import Cancelled
from vfs.browser import BrowserSession
from vfs.confirmation import review_snapshot
from vfs.form import fill_form
from vfs.runner import Runner
from vfs.settings import Settings
from vfs.state import VFSState, detect_state


class HumanUI:
    """Scripted human actions against our local fixture, never a real website."""
    def __init__(self, page, reject=False, mutate_review=False):
        self.page = page
        self.checkpoints = []
        self.reject = reject
        self.mutate_review = mutate_review

    def update(self, *args, **kwargs):
        pass

    def choose(self, state, message, details, options, tick, otp=False):
        self.checkpoints.append(str(state))
        if state == VFSState.APPOINTMENT:
            if self.reject:
                raise Cancelled("User rejected appointment")
            return 'confirm', ''
        if state == VFSState.REVIEW:
            if self.mutate_review:
                self.page.locator('#review-fee').evaluate("node => node.textContent='INR 9000'")
            return 'confirm', ''
        if state == VFSState.PAYMENT:
            self.page.locator('#manual_payment').click()
        return 'continue', ''


def make_runner(page, tmp_path, applicant, mapping, rules, ui=None, mode='appointments'):
    db = Database(tmp_path / 'app.sqlite3')
    db.save_applicant(applicant)
    session = BrowserSession(page, page.context, tmp_path / 'artifacts')
    runner = Runner(session, applicant, mapping, Settings(trace=False), rules, db, ui or HumanUI(page), mode)
    return runner, db


def test_successful_full_booking_has_human_review_and_payment(booking_page, tmp_path, applicant, mapping, rules):
    ui = HumanUI(booking_page)
    runner, db = make_runner(booking_page, tmp_path, applicant, mapping, rules, ui)
    try:
        assert runner.run() == 'confirmed'
        assert ui.checkpoints == ['appointment', 'review', 'payment', 'confirmation']
        assert booking_page.evaluate('window.submitCount') == 1
        assert booking_page.evaluate('window.refreshCount') == 0
        saved = json.loads((tmp_path / 'artifacts/confirmation.json').read_text())
        assert saved['confirmation_reference'] == 'TEST-CONFIRMATION-001'
        assert 'passport' not in saved
        assert db.connection.execute('SELECT status FROM appointment WHERE time="10:30:00"').fetchone()[0] == 'confirmed'
    finally:
        db.close()


def test_form_only_stops_without_submission(booking_page, tmp_path, applicant, mapping, rules):
    runner, db = make_runner(booking_page, tmp_path, applicant, mapping, rules, mode='form')
    try:
        assert runner.run() == 'form_verified'
        assert booking_page.locator('#form-page').is_visible()
        assert booking_page.evaluate('window.submitCount') == 0
    finally:
        db.close()


@pytest.mark.parametrize('challenge', ['captcha', 'otp', 'identity', 'payment', 'blocked'])
def test_security_overlay_takes_priority(booking_page, mapping, challenge):
    booking_page.evaluate("show('form')")
    booking_page.evaluate("name => { const div=document.createElement('div'); div.id=name+'-page'; div.textContent=name;document.body.append(div) }", challenge)
    # Fixture already has a hidden payment section; reveal it instead of duplicating its ID.
    if challenge == 'payment':
        booking_page.locator('#payment-page').first.evaluate('el => el.hidden=false')
        booking_page.locator('#payment-page').last.evaluate('el => el.remove()')
    assert detect_state(booking_page, mapping) == challenge


def test_field_missing_fails_closed(booking_page, applicant, mapping):
    booking_page.evaluate("show('form')")
    booking_page.locator('#passport_number').evaluate('el => el.remove()')
    with pytest.raises(ValueError, match='exactly one'):
        fill_form(booking_page, applicant, mapping)


def test_changed_input_is_detected(booking_page, applicant, mapping):
    booking_page.evaluate("show('form')")
    booking_page.locator('#first_name').evaluate("el => el.addEventListener('input', () => el.value='wrong')")
    with pytest.raises(AssertionError):
        fill_form(booking_page, applicant, mapping)


def test_wrong_route_not_parsed(booking_page, mapping, rules):
    booking_page.evaluate("show('appointment')")
    booking_page.locator('#route-centre').evaluate("el => el.textContent='Mumbai'")
    with pytest.raises(ValueError, match='centre'):
        parse_slots(booking_page, mapping, rules)


def test_disabled_and_stale_slots(booking_page, mapping, rules):
    booking_page.evaluate("show('appointment')")
    booking_page.locator('.slot').first.evaluate('el => el.disabled=true')
    slots = parse_slots(booking_page, mapping, rules)
    assert len(slots) == 2
    candidate = slots[0]
    booking_page.locator('.slot').nth(1).evaluate('el => el.remove()')
    with pytest.raises(ValueError, match='no longer available'):
        select_slot(booking_page, mapping, rules, candidate)


def test_review_mutation_invalidates_approval(booking_page, tmp_path, applicant, mapping, rules):
    runner, db = make_runner(booking_page, tmp_path, applicant, mapping, rules, HumanUI(booking_page, mutate_review=True))
    try:
        with pytest.raises(ValueError, match='changed during review'):
            runner.run()
        assert booking_page.evaluate('window.submitCount') == 0
    finally:
        db.close()


def test_rejection_cannot_submit(booking_page, tmp_path, applicant, mapping, rules):
    runner, db = make_runner(booking_page, tmp_path, applicant, mapping, rules, HumanUI(booking_page, reject=True))
    try:
        with pytest.raises(Cancelled):
            runner.run()
        assert booking_page.evaluate('window.submitCount') == 0
    finally:
        db.close()


def test_unapproved_confirmation_not_saved(booking_page, tmp_path, applicant, mapping, rules):
    runner, db = make_runner(booking_page, tmp_path, applicant, mapping, rules)
    booking_page.evaluate("show('confirmation')")
    try:
        with pytest.raises(ValueError, match='does not match'):
            runner.run()
        assert not (tmp_path / 'artifacts/confirmation.json').exists()
    finally:
        db.close()


def test_http_restriction_latches(booking_page, tmp_path):
    from types import SimpleNamespace
    session = BrowserSession(booking_page, booking_page.context, tmp_path)
    req = SimpleNamespace(url='https://visa.vfsglobal.com/booking', resource_type='xhr')
    session.on_response(SimpleNamespace(request=req, status=429))
    session.on_response(SimpleNamespace(request=req, status=200))
    assert session.blocked


def test_contexts_are_isolated(browser):
    first, second = browser.new_context(), browser.new_context()
    try:
        first.add_cookies([{'name': 'session', 'value': 'synthetic', 'url': 'https://example.com'}])
        assert not second.cookies()
    finally:
        first.close()
        second.close()


@pytest.mark.parametrize('challenge', ['captcha', 'otp', 'identity'])
def test_human_challenge_resumes_only_after_clear(booking_page, tmp_path, applicant, mapping, rules, challenge):
    booking_page.evaluate("name => {const el=document.createElement('div');el.id=name+'-page';el.textContent=name;document.body.append(el)}", challenge)

    class ChallengeUI(HumanUI):
        def choose(self, state, message, details, options, tick, otp=False):
            if str(state) == challenge:
                self.checkpoints.append(str(state))
                booking_page.locator('#' + challenge + '-page').evaluate('el => el.remove()')
                return 'continue', ''
            return super().choose(state, message, details, options, tick, otp)

    ui = ChallengeUI(booking_page)
    runner, db = make_runner(booking_page, tmp_path, applicant, mapping, rules, ui)
    try:
        assert runner.run() == 'confirmed'
        assert ui.checkpoints[0] == challenge
    finally:
        db.close()


def test_unrecognized_empty_calendar_is_error(booking_page, mapping, rules):
    booking_page.evaluate("show('appointment')")
    booking_page.locator('#slots').evaluate("el => el.replaceChildren()")
    with pytest.raises(ValueError, match='No recognizable calendar'):
        parse_slots(booking_page, mapping, rules)


def test_uncertain_click_is_not_replayed(booking_page, tmp_path, applicant, mapping, rules):
    from playwright.sync_api import TimeoutError
    runner, db = make_runner(booking_page, tmp_path, applicant, mapping, rules)
    try:
        # A hidden button causes Playwright's click to time out before navigation.
        booking_page.locator('#dashboard_next').evaluate('el => el.disabled=true')
        with pytest.raises(ValueError, match='will not be retried'):
            runner.run()
        assert booking_page.locator('#dashboard-page').is_visible()
    finally:
        db.close()
