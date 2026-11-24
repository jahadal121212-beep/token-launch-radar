"""Render the token-radar dashboard in headless Chromium (Playwright) and take
the three entry screenshots: the board, a protocol detail view, and a filtered
view. Each shot is 1440x900, saved as PNG."""
import sys
from playwright.sync_api import sync_playwright

BASE = "file:///home/hatch/workspace/makefun/token-radar-entry2/out/dashboard/index.html"
OUT = "/home/hatch/workspace/makefun/token-radar-entry2/shots"
CHROME = "/home/hatch/workspace/makefun/.browser/chrome-linux64/chrome"

SHOTS = [
    ("1-board.png", BASE, None),
    ("2-detail.png", BASE + "#detail=steakhouse-financial", "detail"),
    ("3-filtered.png", BASE + "#cat=Lending", "filtered"),
]

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
        for name, url, kind in SHOTS:
            # Fresh page per shot: a hash-only navigation does not reload the
            # page, so reusing one page would skip the deep-link init.
            page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
            page.goto(url)
            page.wait_for_timeout(1200)
            if kind == "detail":
                page.evaluate("document.getElementById('detail').scrollIntoView()")
                page.wait_for_timeout(400)
            page.screenshot(path=f"{OUT}/{name}")
            print("shot:", name)
            page.close()
        browser.close()

if __name__ == "__main__":
    sys.exit(main())
