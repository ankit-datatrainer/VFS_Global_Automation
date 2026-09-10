from datetime import datetime
from appointment.parser import parse_slots
from vfs.mapping import unique


def select_slot(page, mapping, policy, slot):
    if slot not in parse_slots(page, mapping, policy):
        raise ValueError("Appointment is no longer available")
    spec = mapping.slots
    matches = []
    for row in spec.rows.resolve(page).all():
        if (datetime.strptime(row.get_attribute(spec.date_attribute), spec.date_format).date() == slot.date
            and datetime.strptime(row.get_attribute(spec.time_attribute), spec.time_format).time() == slot.time):
            matches.append(row)
    if len(matches) != 1:
        raise ValueError("Appointment selection is ambiguous")
    target = unique(spec.select, matches[0]) if spec.select else matches[0]
    target.click()
    selected = unique(spec.selected, page)
    if (selected.get_attribute(spec.date_attribute) != slot.date.strftime(spec.date_format)
        or selected.get_attribute(spec.time_attribute) != slot.time.strftime(spec.time_format)):
        raise ValueError("Selected appointment did not match the requested date and time")
