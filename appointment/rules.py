from datetime import date


def rank_slots(slots, policy, travel_date):
    valid = [slot for slot in slots if (
        slot.source == "authenticated" and slot.centre == policy.centre
        and slot.visa_type == policy.visa_type and slot.application_category == policy.application_category
        and max(date.today(), policy.earliest_date) <= slot.date <= policy.latest_date
        and slot.date < travel_date and slot.date.weekday() in policy.preferred_weekdays
        and policy.earliest_time <= slot.time <= policy.latest_time)]
    return sorted(valid, key=lambda slot: (slot.date, slot.time))
