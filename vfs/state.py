from enum import StrEnum
import re
from vfs.mapping import visible


class VFSState(StrEnum):
    START = "start"
    LOGIN = "login"
    DASHBOARD = "dashboard"
    APPLICATION = "application"
    FORM = "form"
    APPOINTMENT = "appointment"
    CAPTCHA = "captcha"
    OTP = "otp"
    IDENTITY = "identity"
    REVIEW = "review"
    PAYMENT = "payment"
    CONFIRMATION = "confirmation"
    BLOCKED = "blocked"
    ERROR = "error"
    UNKNOWN = "unknown"


SECURITY_STATES = {VFSState.CAPTCHA, VFSState.OTP, VFSState.IDENTITY, VFSState.PAYMENT}


def detect_state(page, mapping, blocked=False):
    if blocked:
        return VFSState.BLOCKED
    # Security evidence takes precedence over a login/form/calendar behind an overlay.
    body = page.locator("body").inner_text(timeout=5000)
    if re.search(r"too many requests|access denied|temporarily blocked|unusual traffic|suspicious activity|rate limit", body, re.I):
        return VFSState.BLOCKED
    for state in (VFSState.BLOCKED, VFSState.CAPTCHA, VFSState.OTP, VFSState.IDENTITY, VFSState.PAYMENT, VFSState.ERROR):
        if visible(mapping.states.get(state.value), page):
            return state
    if page.locator('iframe[title*="challenge" i]:visible, iframe[title*="captcha" i]:visible').count():
        return VFSState.CAPTCHA
    if re.search(r"verify you are human|complete the captcha|checking your browser", body, re.I):
        return VFSState.CAPTCHA
    if page.locator('input[autocomplete="one-time-code"]:visible').count():
        return VFSState.OTP
    if page.locator('input[type="password"]:visible').count():
        return VFSState.LOGIN
    for state in (VFSState.CONFIRMATION, VFSState.REVIEW, VFSState.APPOINTMENT,
                  VFSState.FORM, VFSState.APPLICATION, VFSState.DASHBOARD, VFSState.LOGIN):
        if visible(mapping.states.get(state.value), page):
            return state
    return VFSState.UNKNOWN
