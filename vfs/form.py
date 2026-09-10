from datetime import date
from playwright.sync_api import expect
from vfs.mapping import unique


def write_and_verify(page, spec, value):
    locator = unique(spec.locator, page)
    if spec.kind == "checkbox":
        if not isinstance(value, bool):
            raise ValueError("Checkbox mapping requires a boolean applicant value")
        locator.set_checked(value)
        expect(locator).to_be_checked(checked=value)
        return
    text = value.strftime(spec.date_format) if isinstance(value, date) else str(value)
    text = spec.values.get(text, text)
    if spec.kind == "select":
        locator.select_option(value=text)
        expect(locator).to_have_value(text)
    elif spec.kind == "combobox":
        locator.click()
        page.get_by_role("option", name=text, exact=True).click()
        expect(locator).to_have_text(text)
    else:
        locator.fill(text)
        expect(locator).to_have_value(text)


def fill_form(page, applicant, mapping, guard=lambda: None, log=lambda action: None):
    if not mapping.fields:
        raise ValueError("No verified form mapping")
    for name, spec in mapping.fields.items():
        guard()
        if name not in type(applicant).model_fields:
            raise ValueError("Unknown applicant field in form mapping")
        write_and_verify(page, spec, getattr(applicant, name))
        log("verified field " + name)
