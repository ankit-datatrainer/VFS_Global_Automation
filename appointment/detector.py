from vfs.mapping import visible
from appointment.parser import route_evidence


def appointment_ready(page, mapping, rules):
    if not visible(mapping.states.get("appointment"), page):
        return False
    route_evidence(page, mapping, rules)
    return True
