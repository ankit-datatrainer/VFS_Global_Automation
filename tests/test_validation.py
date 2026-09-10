from datetime import date, timedelta
import pytest
from pydantic import ValidationError
from applicant.model import Applicant
from database.db import Database
from vfs.settings import Monitor, Rules
from vfs.mapping import load_mapping
from vfs.settings import ROOT


@pytest.mark.parametrize("field,value", [
    ("first_name", " "), ("last_name", ""), ("passport_number", "bad"),
    ("date_of_birth", "2999-01-01"), ("passport_expiry_date", "2020-01-01"),
    ("passport_issue_date", "2999-01-01"), ("nationality", "USA"),
    ("email", "invalid"), ("phone", "9000000000"), ("visa_type", "C"),
    ("application_category", ""), ("vfs_centre", "Mumbai"), ("travel_date", "2020-01-01"),
    ("id", "../../private"), ("purpose", "tourism")])
def test_invalid_fields(applicant, field, value):
    with pytest.raises(ValidationError):
        Applicant.model_validate({**applicant.model_dump(), field: value})


def test_database_roundtrip_and_appointment(tmp_path, applicant, rules):
    from appointment.parser import Slot
    db = Database(tmp_path / 'test.sqlite3')
    db.save_applicant(applicant)
    assert db.load_applicant(applicant.id) == applicant
    slot = Slot(date=rules.earliest_date, time='10:00', centre='New Delhi', visa_type='D', application_category='Type D')
    db.record_slot(applicant.id, slot)
    db.record_slot(applicant.id, slot, 'selected')
    db.record_slot(applicant.id, slot, 'confirmed', 'TEST-001')
    rows = db.connection.execute('SELECT * FROM appointment').fetchall()
    assert len(rows) == 1 and rows[0]['confirmation_reference'] == 'TEST-001'
    assert rows[0]['selected_at']
    db.close()


def test_live_mapping_is_not_invented():
    with pytest.raises(ValueError, match='not been verified'):
        load_mapping(ROOT / 'config/selectors.yaml').require_live()


def test_form_stage_does_not_require_booking_mapping(mapping):
    mapping.states = {k: v for k, v in mapping.states.items() if k in ('dashboard', 'application', 'form')}
    mapping.slots = None
    mapping.review = {}
    mapping.confirmation_reference = None
    assert mapping.require_live('form')
    with pytest.raises(ValueError):
        mapping.require_live('appointments')


@pytest.mark.parametrize('values', [{'interval_seconds': 1}, {'maximum_checks_per_hour': 31}, {'retry_on_network_error': 4}])
def test_unsafe_monitor_settings_rejected(values):
    with pytest.raises(ValidationError):
        Monitor(**values)


def test_bad_rules_rejected(rules):
    with pytest.raises(ValidationError):
        Rules.model_validate({**rules.model_dump(), 'latest_date': date.today() - timedelta(days=1)})
