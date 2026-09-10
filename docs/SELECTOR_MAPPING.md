# Inspect and map the authenticated route

`config/selectors.yaml` deliberately starts with `verified: false`. Part III of
ImplementationPlan.md requires observed page selectors. No authenticated VFS
pages were supplied, so the live mapping is **not complete**. The local fixture
is a functional test of the engine and is not evidence of VFS compatibility.

Run `npm start -- inspect` (or choose **Inspect pages** in the dashboard). Chrome
opens the official portal with an ordinary fresh context. Log in manually and
visit the relevant pages. Capture inventories with the local dashboard. They
contain element identifiers and roles, excluding input values, cookies and
network data. They remain private under `artifacts/inspection/`. Inventory
labels/identifiers should still be reviewed before sharing.

Use Playwright's accessibility inspector or browser developer tools to identify
exact labels and roles. Prefer role + exact accessible name, then exact label,
stable id, test id, and finally observed CSS. Never use screen coordinates.

The mapping schema is implemented in `vfs/mapping.py`. `tests/conftest.py` builds
the complete synthetic mapping against `tests/fixtures/booking.html`. Copy its
**structure**, not its selector values, when mapping VFS.

Each locator uses `by: role|label|id|test_id|css`, `value`, and (for a role)
`name`. For example, this is illustrative syntax, **not a VFS selector**:

```yaml
fields:
  first_name:
    locator: {by: label, value: '<observed exact label>'}
    kind: text
  passport_expiry_date:
    locator: {by: id, value: '<observed input id>'}
    kind: date
    date_format: '%d/%m/%Y'
  nationality:
    locator: {by: label, value: '<observed exact label>'}
    kind: select
    values: {IND: '<observed option value>'}
```

Required mapping components:

- `states`: dashboard, application, form, appointment, review, payment and
  confirmation. Add observed login, captcha, otp, identity, blocked and error
  markers. Security markers must match the visible challenge, not a background
  widget. Unknown pages stop for inspection.
- `fields`: all actual applicant fields. Native selects use exact option values;
  custom comboboxes use exact option names and verify displayed text. Checkboxes
  must map to boolean applicant fields; no consent checkboxes are inferred.
- `route_choices`: observed dropdowns and their exact values for the Type D route.
- `authenticated`: one visible marker proving the active logged-in session.
- `availability_ready`: an observed marker proving that the calendar has loaded;
  optional `loading` identifies a spinner which must disappear before parsing.
  `no_slots` is an explicit no-availability marker. An empty unrecognized calendar
  is treated as an error, not as evidence that no appointments exist.
- `route_summary`: visible country, visa_type, centre and application_category
  markers. The current adapter expects exact normalized text `Bulgaria`, `D`,
  `New Delhi` and the configured application category.
- `actions`: dashboard_next, application_next, form_next, appointment_next,
  review_submit, and optionally refresh_availability. These must be the actual
  UI buttons. Do not map a payment button to an automated action.
- `slots`: an observed collection of available date/time rows, exact date/time
  attributes and formats, an optional nested selection control, and one
  `selected` marker carrying the selected date/time attributes. Disabled slots
  are ignored. Public EAD is never used as a slot source.
- `review`: applicant, passport, country, visa_type, centre, date, time and fee
  locators. Current adapter expects ISO dates, 24-hour `HH:MM` times, full passport
  number and full applicant name. These locators must work on review, payment and
  confirmation pages. If VFS uses other formats or masks information, extend
  and test this adapter using observed evidence; do not disable verification.
- `confirmation_reference`: the actual nonempty confirmation reference.
- `otp`: optional exact input for a manually supplied OTP. The human submits it.

The existing slot adapter supports date/time rows already present in the DOM.
If VFS exposes dates first and loads times only after a date is clicked, or uses
separate calendar months, that observed layout needs a dedicated parser and
navigation adaptation before enabling live execution. Do not treat a public
date hint or an empty/unrecognized calendar as proof of bookable availability.

Set `observed_on` and `notes` to the inspection date and route details. Set
`verified: true` only after every required locator has been checked on the
authenticated pages. Run form-only mode first. Unknown/missing/ambiguous fields
fail closed and produce diagnostics. Setting this flag alone is not validation.

Form-only mode needs the dashboard/application/form states, authenticated route
evidence, applicant fields and initial navigation actions. It can be verified
before mapping the calendar, payment or confirmation pages. Appointment mode
requires the complete mapping.
