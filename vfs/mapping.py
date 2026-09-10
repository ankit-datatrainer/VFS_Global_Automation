"""Only observed, explicitly verified mappings can control a live booking page."""
from datetime import date
from typing import Literal
from pydantic import Field, model_validator
from vfs.settings import StrictModel, read_yaml


class LocatorSpec(StrictModel):
    by: Literal["role", "label", "id", "test_id", "css"]
    value: str = Field(min_length=1)
    name: str | None = None

    @model_validator(mode="after")
    def role_name(self):
        if self.by == "role" and not self.name:
            raise ValueError("Role locators require an exact accessible name")
        return self

    def resolve(self, page):
        if self.by == "role":
            return page.get_by_role(self.value, name=self.name, exact=True)
        if self.by == "label":
            return page.get_by_label(self.value, exact=True)
        if self.by == "id":
            # Attribute values are quoted and escaped, never interpolated as raw CSS.
            import json
            return page.locator('[id=' + json.dumps(self.value) + ']')
        if self.by == "test_id":
            return page.get_by_test_id(self.value)
        return page.locator(self.value)


class FieldSpec(StrictModel):
    locator: LocatorSpec
    kind: Literal["text", "date", "select", "combobox", "checkbox"] = "text"
    date_format: str = "%Y-%m-%d"
    values: dict[str, str] = Field(default_factory=dict)


class RouteChoice(StrictModel):
    field: FieldSpec
    value: str


class SlotMapping(StrictModel):
    rows: LocatorSpec
    date_attribute: str
    time_attribute: str
    date_format: str = "%Y-%m-%d"
    time_format: str = "%H:%M"
    select: LocatorSpec | None = None
    selected: LocatorSpec


class Mapping(StrictModel):
    verified: bool = False
    observed_on: date | None = None
    notes: str = ""
    states: dict[str, LocatorSpec] = Field(default_factory=dict)
    fields: dict[str, FieldSpec] = Field(default_factory=dict)
    route_choices: list[RouteChoice] = Field(default_factory=list)
    actions: dict[str, LocatorSpec] = Field(default_factory=dict)
    authenticated: LocatorSpec | None = None
    availability_ready: LocatorSpec | None = None
    no_slots: LocatorSpec | None = None
    loading: LocatorSpec | None = None
    route_summary: dict[str, LocatorSpec] = Field(default_factory=dict)
    slots: SlotMapping | None = None
    review: dict[str, LocatorSpec] = Field(default_factory=dict)
    confirmation_reference: LocatorSpec | None = None
    otp: LocatorSpec | None = None

    def require_live(self, mode="appointments"):
        if not self.verified or not self.observed_on or not self.notes.strip():
            raise ValueError("Live selectors have not been verified against the authenticated Type D / New Delhi pages. See config/selectors.yaml.")
        required_states = {"dashboard", "application", "form"}
        if mode == "appointments":
            required_states |= {"appointment", "review", "payment", "confirmation"}
        if not required_states <= self.states.keys():
            raise ValueError("Live mapping is missing required page states")
        required_fields = {"first_name", "last_name", "date_of_birth", "passport_number", "passport_expiry_date", "nationality", "email", "phone"}
        if not required_fields <= self.fields.keys():
            raise ValueError("Live mapping is missing applicant fields")
        if not self.authenticated:
            raise ValueError("Live mapping requires authenticated page evidence")
        if not {"country", "visa_type", "centre", "application_category"} <= self.route_summary.keys():
            raise ValueError("Live mapping requires route verification")
        if mode == "form":
            if not {"dashboard_next", "application_next"} <= self.actions.keys():
                raise ValueError("Form mapping is missing navigation actions")
            return self
        if not self.slots or not self.confirmation_reference or not self.availability_ready:
            raise ValueError("Live mapping requires slot and confirmation evidence")
        if not {"applicant", "passport", "country", "visa_type", "centre", "date", "time", "fee"} <= self.review.keys():
            raise ValueError("Live mapping requires complete booking review fields")
        if not {"dashboard_next", "application_next", "form_next", "appointment_next", "review_submit"} <= self.actions.keys():
            raise ValueError("Live mapping is missing navigation actions")
        return self


def load_mapping(path):
    return read_yaml(path, Mapping)


def visible(spec, page):
    if not spec:
        return False
    locator = spec.resolve(page)
    return locator.count() == 1 and locator.is_visible()


def unique(spec, page):
    locator = spec.resolve(page)
    if locator.count() != 1 or not locator.is_visible():
        raise ValueError("Expected exactly one visible mapped element; inspect the page mapping")
    return locator
