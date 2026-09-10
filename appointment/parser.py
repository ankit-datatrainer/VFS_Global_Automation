from datetime import date, datetime, time
from typing import Literal
from pydantic import BaseModel
from playwright.sync_api import expect
from vfs.mapping import unique, visible


class Slot(BaseModel):
    date: date
    time: time
    centre: str
    visa_type: str
    application_category: str
    source: Literal["authenticated", "ead"] = "authenticated"


def route_evidence(page, mapping, rules):
    if not visible(mapping.authenticated, page):
        raise ValueError("Actual slots require authenticated page evidence")
    expected = {"country": "Bulgaria", "centre": rules.centre, "visa_type": rules.visa_type,
                "application_category": rules.application_category}
    for key, value in expected.items():
        spec = mapping.route_summary.get(key)
        if not spec or unique(spec, page).inner_text().strip() != value:
            raise ValueError("Booking route does not match " + key)


def parse_slots(page, mapping, rules):
    if mapping.loading:
        expect(mapping.loading.resolve(page)).to_be_hidden()
    if not mapping.availability_ready:
        raise ValueError("No observed availability-ready marker")
    expect(mapping.availability_ready.resolve(page)).to_be_visible()
    route_evidence(page, mapping, rules)
    spec = mapping.slots
    if not spec:
        raise ValueError("No verified appointment mapping")
    slots = []
    rows = spec.rows.resolve(page).all()
    if not rows and not visible(mapping.no_slots, page):
        raise ValueError("No recognizable calendar rows or explicit no-availability message")
    for row in rows:
        target = spec.select.resolve(row) if spec.select else row
        if not row.is_visible() or not target.is_enabled() or target.get_attribute("aria-disabled") == "true":
            continue
        raw_date, raw_time = row.get_attribute(spec.date_attribute), row.get_attribute(spec.time_attribute)
        if not raw_date or not raw_time:
            raise ValueError("Appointment row missing a date or time; update the parser mapping")
        slots.append(Slot(date=datetime.strptime(raw_date, spec.date_format).date(),
                          time=datetime.strptime(raw_time, spec.time_format).time(),
                          centre=rules.centre, visa_type=rules.visa_type,
                          application_category=rules.application_category))
    return slots
