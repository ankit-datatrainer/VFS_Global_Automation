import pytest
from appointment.monitor import MonitorBudget, MonitorLimit
from appointment.rules import rank_slots
from appointment.parser import Slot
from vfs.settings import Monitor


def test_limits_and_cooldown():
    clock = [0]
    budget = MonitorBudget(Monitor(maximum_checks_per_hour=2), lambda: clock[0])
    budget.begin_check()
    assert budget.delay() == 300
    with pytest.raises(MonitorLimit):
        budget.begin_check()
    clock[0] = 300
    budget.begin_check()
    assert budget.delay() == 3300
    budget.network_error()
    budget.network_error()
    with pytest.raises(MonitorLimit, match='retry budget'):
        budget.network_error()
    clock[0] = 3600
    with pytest.raises(MonitorLimit, match='duration'):
        budget.check_session()


def test_total_checks():
    budget = MonitorBudget(Monitor(maximum_checks=1), lambda: 0)
    budget.begin_check()
    with pytest.raises(MonitorLimit, match='Maximum appointment checks'):
        budget.delay()


def test_ranking_excludes_ead_wrong_route_time_and_category(rules, applicant):
    base = dict(date=rules.earliest_date, time='10:30', centre='New Delhi', visa_type='D', application_category='Type D')
    variants = [base, {**base, 'time': '09:30'}, {**base, 'source': 'ead'}, {**base, 'centre': 'Mumbai'},
                {**base, 'visa_type': 'C'}, {**base, 'time': '08:00'}, {**base, 'application_category': 'Tourist'}]
    result = rank_slots([Slot(**v) for v in variants], rules, applicant.travel_date)
    assert [s.time.strftime('%H:%M') for s in result] == ['09:30', '10:30']
