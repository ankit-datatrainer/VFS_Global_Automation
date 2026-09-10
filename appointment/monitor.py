from collections import deque
import time


class MonitorLimit(RuntimeError):
    pass


class MonitorBudget:
    def __init__(self, policy, clock=time.monotonic):
        self.policy, self.clock = policy, clock
        self.started = clock()
        self.checks = 0
        self.retries = 0
        self.errors = 0
        self.history = deque()
        self.next_check = self.started

    def check_session(self):
        if self.clock() - self.started >= self.policy.maximum_session_minutes * 60:
            raise MonitorLimit("Maximum session duration reached")

    def delay(self):
        self.check_session()
        now = self.clock()
        if self.checks >= self.policy.maximum_checks:
            raise MonitorLimit("Maximum appointment checks reached")
        while self.history and now - self.history[0] >= 3600:
            self.history.popleft()
        due = self.next_check
        if len(self.history) >= self.policy.maximum_checks_per_hour:
            due = max(due, self.history[0] + 3600)
        return max(0, due - now)

    def begin_check(self):
        if self.delay() > 0:
            raise MonitorLimit("Appointment check attempted before its scheduled time")
        self.checks += 1
        self.history.append(self.clock())
        self.next_check = self.clock() + self.policy.interval_seconds

    def success(self):
        self.errors = 0

    def network_error(self):
        self.errors += 1
        if self.errors >= self.policy.maximum_consecutive_errors or self.retries >= self.policy.retry_on_network_error:
            raise MonitorLimit("Network retry budget exhausted; human review required")
        self.retries += 1
        self.next_check = max(self.next_check, self.clock() + self.policy.cooldown_seconds)
