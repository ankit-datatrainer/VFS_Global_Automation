from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright


class BrowserSession:
    def __init__(self, page, context, artifact_dir):
        self.page, self.context = page, context
        self.artifact_dir = Path(artifact_dir)
        self.blocked = False
        self.network_failure = False
        self.tracing = False
        self.trace_number = 0
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        context.on("response", self.on_response)
        context.on("requestfailed", self.on_failure)

    def set_tracing(self, enabled):
        if enabled and not self.tracing:
            self.context.tracing.start(screenshots=True, snapshots=True, sources=True)
            self.tracing = True
        elif self.tracing and not enabled:
            self.trace_number += 1
            self.context.tracing.stop(path=str(self.artifact_dir / f"trace-{self.trace_number:03d}.zip"))
            self.tracing = False

    def relevant(self, request):
        host = urlsplit(request.url).hostname or ""
        return (host == "vfsglobal.com" or host.endswith(".vfsglobal.com")) and request.resource_type in ("document", "xhr", "fetch")

    def on_response(self, response):
        if self.relevant(response.request) and response.status in (403, 429):
            self.blocked = True  # Latched for the remainder of the session.
        if self.relevant(response.request) and response.status >= 500:
            self.network_failure = True

    def on_failure(self, request):
        if self.relevant(request):
            self.network_failure = True

    def screenshot(self, reason):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        path = self.artifact_dir / f"{stamp}-{reason}.png"
        # Inputs are masked, but confirmation text can still contain personal data.
        self.page.screenshot(path=str(path), full_page=True,
                             mask=[self.page.locator("input, textarea")])
        return path


@contextmanager
def launch(settings, artifact_dir):
    with sync_playwright() as playwright:
        options = {"headless": False}
        if settings.browser_channel == "chrome":
            options["channel"] = "chrome"
        browser = playwright.chromium.launch(**options)
        context = browser.new_context()  # Fresh applicant session; no shared cookies.
        context.set_default_timeout(settings.action_timeout_ms)
        session = BrowserSession(context.new_page(), context, artifact_dir)
        try:
            yield session
        finally:
            try:
                session.set_tracing(False)
            finally:
                context.close()
                browser.close()
