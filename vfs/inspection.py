"""Capture locator evidence from pages the operator visits manually."""
from datetime import datetime, timezone
import json
import time
from urllib.parse import urlsplit
from vfs.browser import launch


def inspect_pages(settings, artifact_dir, ui):
    started = time.monotonic()
    with launch(settings.model_copy(update={"trace": False}), artifact_dir) as session:
        ui.open_browser = session.page.bring_to_front
        session.page.goto(settings.portal_url, wait_until="domcontentloaded")

        def tick():
            if time.monotonic() - started >= settings.monitor.maximum_session_minutes * 60:
                raise ValueError("Inspection session duration reached")
            session.page.wait_for_timeout(100)

        while True:
            answer, _ = ui.choose("inspect pages", "Navigate manually; capture each relevant page after it loads.",
                                  "Login, select Bulgaria / Type D / New Delhi, and navigate normally.\n"
                                  "Capture dashboard, application, form, appointment, review and confirmation structure.\n"
                                  "Inputs and credentials are not exported. Do not complete a booking just to collect selectors.\n\n"
                                  "Captured locator inventories are saved under artifacts/inspection.",
                                  [("Capture locator inventory", "capture"), ("Finish inspection", "finish")], tick)
            if answer == "finish":
                return
            if session.blocked:
                raise ValueError("VFS returned a restriction. Inspection stopped; review the browser manually.")
            # No input values, page text, cookies, credentials, network payloads or scripts.
            elements = session.page.locator("input,select,textarea,button,[role],label,[data-testid]").evaluate_all("""nodes => nodes.map(el => ({
              tag: el.tagName.toLowerCase(), id: el.id || null,
              name: el.getAttribute('name'), type: el.getAttribute('type'),
              role: el.getAttribute('role'), test_id: el.getAttribute('data-testid'),
              label: el.getAttribute('aria-label'), for: el.getAttribute('for'),
              visible: !!(el.getClientRects().length)
            }))""")
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
            origin = urlsplit(session.page.url)
            target = session.artifact_dir / (stamp + '-locators.json')
            target.write_text(json.dumps({"origin": origin.scheme + '://' + origin.netloc, "elements": elements}, indent=2), encoding='utf-8')
            ui.update(details="Locator inventory saved: " + str(target))
