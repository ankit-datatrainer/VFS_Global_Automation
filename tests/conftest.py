from datetime import date, timedelta
from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright
from applicant.model import Applicant
from vfs.mapping import Mapping
from vfs.settings import Rules


@pytest.fixture
def applicant():
    return Applicant(id="TEST001", first_name="Test", last_name="Applicant", date_of_birth="1995-06-15",
                     place_of_birth="Delhi", passport_number="Z0000000", passport_issue_date="2020-01-01",
                     passport_expiry_date=date.today() + timedelta(days=3650), email="test@example.com",
                     phone="+919000000000", address="Synthetic test address", application_category="Type D",
                     purpose="work", travel_date=date.today() + timedelta(days=180))


@pytest.fixture
def rules():
    return Rules(application_category="Type D", earliest_date=date.today() + timedelta(days=1),
                 latest_date=date.today() + timedelta(days=120), preferred_weekdays=list(range(7)))


def identifier(value):
    return {"by": "id", "value": value}


@pytest.fixture
def mapping():
    fields = {name: {"locator": {"by": "label", "value": name}, "kind": "text"}
              for name in ["first_name", "last_name", "date_of_birth", "passport_number", "passport_expiry_date", "nationality", "email", "phone"]}
    fields['nationality']['kind'] = 'select'
    fields['biometrics_required'] = {"locator": {"by": "label", "value": "biometrics_required"}, "kind": "checkbox"}
    fields['date_of_birth']['kind'] = 'date'
    fields['passport_expiry_date']['kind'] = 'date'
    return Mapping.model_validate({
        "verified": True, "observed_on": date.today(), "notes": "Observed local synthetic fixture only; never VFS selectors",
        "states": {name: identifier(name + "-page") for name in ["login", "dashboard", "application", "form", "appointment", "captcha", "otp", "identity", "review", "payment", "confirmation", "blocked", "error"]},
        "fields": fields, "authenticated": identifier("authenticated"), "availability_ready": identifier("appointment-page"),
        "route_summary": {k: identifier("route-" + k) for k in ["country", "centre", "visa_type", "application_category"]},
        "actions": {k: identifier(k) for k in ["dashboard_next", "application_next", "form_next", "appointment_next", "review_submit", "refresh_availability"]},
        "review": {k: identifier("review-" + k) for k in ["applicant", "passport", "country", "visa_type", "centre", "date", "time", "fee"]},
        "confirmation_reference": identifier("reference"), "otp": identifier("otp-input"),
        "slots": {"rows": {"by": "css", "value": ".slot"}, "date_attribute": "data-date", "time_attribute": "data-time", "selected": identifier("selected-slot")}})


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def page(browser):
    context = browser.new_context()
    context.set_default_timeout(1000)
    page = context.new_page()
    yield page
    context.close()


@pytest.fixture
def booking_page(page, applicant, rules):
    html = (Path(__file__).parent / "fixtures/booking.html").read_text(encoding="utf-8")
    page.set_content(html)
    page.evaluate("data => setup(data)", {"applicant": applicant.model_dump(mode="json"), "date": rules.earliest_date.isoformat()})
    return page
