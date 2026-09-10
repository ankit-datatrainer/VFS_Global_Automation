"""Validated, route-specific applicant data. No credentials belong in this model."""
from datetime import date
import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class Applicant(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    first_name: str = Field(min_length=1, max_length=100)
    middle_name: str = ""
    last_name: str = Field(min_length=1, max_length=100)
    date_of_birth: date
    place_of_birth: str = Field(min_length=1)
    nationality: Literal["IND"] = "IND"
    passport_number: str
    passport_issue_date: date
    passport_expiry_date: date
    email: EmailStr
    phone: str
    address: str = Field(min_length=1)
    country: Literal["Bulgaria"] = "Bulgaria"
    visa_type: Literal["D"] = "D"
    application_category: str = Field(min_length=1)
    purpose: Literal["work", "study", "family", "other"]
    travel_date: date
    vfs_centre: Literal["New Delhi"] = "New Delhi"
    documents: list[str] = Field(default_factory=list)
    biometrics_required: bool = True
    consular_interview: Literal["unknown", "required", "not_required", "completed"] = "unknown"
    status: str = "validated"

    @field_validator("passport_number")
    @classmethod
    def passport(cls, value):
        value = value.upper()
        if not re.fullmatch(r"[A-Z][0-9]{7}", value):
            raise ValueError("Expected Indian passport format: one letter and seven digits")
        return value

    @field_validator("phone")
    @classmethod
    def telephone(cls, value):
        if not re.fullmatch(r"\+[1-9][0-9]{7,14}", value):
            raise ValueError("Use an international phone number, for example +91 followed by 10 digits")
        return value

    @model_validator(mode="after")
    def dates(self):
        today = date.today()
        if not date(1900, 1, 1) <= self.date_of_birth < today:
            raise ValueError("Date of birth must be in the past")
        if not self.date_of_birth <= self.passport_issue_date <= today:
            raise ValueError("Passport issue date must be between birth and today")
        if self.travel_date < today:
            raise ValueError("Travel date must not be in the past")
        if self.passport_expiry_date <= max(today, self.passport_issue_date, self.travel_date):
            raise ValueError("Passport must be unexpired at travel; verify route-specific validity separately")
        return self
