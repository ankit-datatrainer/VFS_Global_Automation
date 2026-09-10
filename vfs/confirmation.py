import json
from vfs.mapping import unique


def review_snapshot(page, mapping, applicant, slot):
    if not slot:
        raise ValueError("No verified selected appointment exists for final review")
    expected = {
        "applicant": " ".join(filter(None, [applicant.first_name, applicant.middle_name, applicant.last_name])),
        "passport": applicant.passport_number, "country": "Bulgaria", "visa_type": "D",
        "centre": slot.centre, "date": slot.date.isoformat(), "time": slot.time.strftime("%H:%M")}
    actual = {}
    for key, value in expected.items():
        if key not in mapping.review:
            raise ValueError("Missing final review mapping: " + key)
        actual[key] = unique(mapping.review[key], page).inner_text().strip()
        if actual[key] != value:
            raise ValueError("Final review mismatch: " + key)
    if "fee" not in mapping.review:
        raise ValueError("Missing fee review mapping")
    actual["fee"] = unique(mapping.review["fee"], page).inner_text().strip()
    if not actual["fee"]:
        raise ValueError("Fee must be visible for final review")
    return actual


def save_confirmation(session, mapping, applicant, slot, approved, database):
    if not approved or review_snapshot(session.page, mapping, applicant, slot) != approved:
        raise ValueError("Confirmation does not match the approved booking")
    reference = unique(mapping.confirmation_reference, session.page).inner_text().strip()
    if not reference:
        raise ValueError("Confirmation reference is missing")
    path = session.artifact_dir / "confirmation.json"
    path.write_text(json.dumps({"applicant_id": applicant.id, "appointment": slot.model_dump(mode="json"),
                                "confirmation_reference": reference}, indent=2), encoding="utf-8")
    session.screenshot("confirmation")
    database.record_slot(applicant.id, slot, "confirmed", reference)
    return path
