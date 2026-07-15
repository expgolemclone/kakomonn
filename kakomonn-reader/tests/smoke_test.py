from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys

from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "kakomonn-reader.user.js"


MOCK_BODY = """
  <div id=\"meta\">中小企業診断士試験 令和6年度 第1問</div>
  <p>これは動作確認用の問題文です.</p>
  <div><label><input type=\"radio\" name=\"answer\">選択肢1</label></div>
  <div><label><input type=\"radio\" name=\"answer\">選択肢2</label></div>
  <button type=\"button\">解答する</button>
  <h2>この過去問の解説</h2>
  <p>これは動作確認用の解説です.</p>
  <a href=\"#report\">（訂正依頼・報告はこちら）</a>
  <button id=\"next\" type=\"button\">次の問題へ</button>
"""


def main() -> None:
    subprocess.run([sys.executable, "build.py"], cwd=REPO_ROOT, check=True)
    chromium = shutil.which("chromium")
    if chromium is None:
        raise RuntimeError("chromium is required for the smoke test")

    script = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "// @version" not in script

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=chromium,
            headless=True,
            args=["--no-sandbox"],
        )
        context = browser.new_context()
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        page.set_content("<!doctype html><html><body></body></html>")
        page.evaluate(
            """() => {
                const store = new Map();
                Object.defineProperty(window, "localStorage", {
                    configurable: true,
                    value: {
                        getItem: key => store.has(key) ? store.get(key) : null,
                        setItem: (key, value) => store.set(key, String(value)),
                        removeItem: key => store.delete(key),
                        clear: () => store.clear(),
                    },
                });
            }"""
        )
        page.add_script_tag(content=script)
        page.wait_for_selector("#kakomonn-reader-frame")

        child_frames = [frame for frame in page.frames if frame != page.main_frame]
        assert len(child_frames) == 1
        child_frame = child_frames[0]
        child_frame.evaluate(
            "html => { document.body.innerHTML = html; }",
            MOCK_BODY,
        )

        page.wait_for_timeout(900)
        assert page.locator("#kakomonn-reader-count").inner_text() == "0/100"
        assert page.locator("#kakomonn-reader-start").is_visible()

        page.locator("#kakomonn-reader-start").click()
        page.wait_for_selector("#kakomonn-reader-next", state="visible")
        page.wait_for_function(
            "document.querySelector('#kakomonn-reader-next').disabled === false"
        )

        child_frame.locator("#next").click()
        page.wait_for_function(
            "document.querySelector('#kakomonn-reader-count').textContent === '1/100'"
        )

        assert errors == [], errors
        browser.close()

    print("smoke test passed")


if __name__ == "__main__":
    main()
