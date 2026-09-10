from datetime import date, time
from pathlib import Path
from typing import Literal
import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parents[1]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Monitor(StrictModel):
    enabled: bool = True
    maximum_session_minutes: int = Field(default=60, ge=1, le=60)
    maximum_checks: int = Field(default=30, ge=1, le=30)
    maximum_checks_per_hour: int = Field(default=12, ge=1, le=30)
    interval_seconds: int = Field(default=300, ge=120)
    retry_on_network_error: int = Field(default=3, ge=0, le=3)
    maximum_consecutive_errors: int = Field(default=3, ge=1, le=3)
    cooldown_seconds: int = Field(default=300, ge=120)


class Settings(StrictModel):
    portal_url: Literal["https://visa.vfsglobal.com/ind/en/bgr"] = "https://visa.vfsglobal.com/ind/en/bgr"
    browser_channel: Literal["chrome", "chromium"] = "chrome"
    trace: bool = True
    action_timeout_ms: int = Field(default=15000, ge=1000, le=60000)
    monitor: Monitor = Field(default_factory=Monitor)


class Rules(StrictModel):
    centre: Literal["New Delhi"] = "New Delhi"
    visa_type: Literal["D"] = "D"
    application_category: str = Field(min_length=1)
    earliest_date: date
    latest_date: date
    preferred_weekdays: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    earliest_time: time = time(9)
    latest_time: time = time(14)

    @model_validator(mode="after")
    def ordered(self):
        if self.earliest_date > self.latest_date or self.earliest_time > self.latest_time:
            raise ValueError("Appointment range must be ordered")
        if not self.preferred_weekdays or any(d not in range(7) for d in self.preferred_weekdays):
            raise ValueError("Weekdays must use Monday=0 through Sunday=6")
        return self


def read_yaml(path, model):
    return model.model_validate(yaml.safe_load(Path(path).read_text(encoding="utf-8")))
