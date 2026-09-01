from __future__ import annotations

import base64
import hashlib
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "src"
OUTPUT_PATH = ROOT / "kakomonn-reader.user.js"
ASSET_DIR = ROOT / "assets" / "feedback"
BUILD_FINGERPRINT_PLACEHOLDER = "__KAKOMONN_READER_BUILD_FINGERPRINT__"
VERSION_PATTERN = re.compile(rb"^// @version\s+(\d+\.\d+\.\d+)\s*$", re.MULTILINE)
SOURCE_NAMES = (
    "metadata-and-runtime.js",
    "correct-feedback.js",
    "styles.js",
    "sync-and-catalog.js",
    "next-question-launcher.js",
    "ui.js",
    "content-extraction.js",
    "speech.js",
    "page-lifecycle.js",
    "markdown-copy.js",
    "navigation.js",
    "shortcuts-and-bootstrap.js",
)
FEEDBACK_ASSETS = {
    "__KAKOMONN_FEEDBACK_NORMAL__": "correct-normal.mp3",
    "__KAKOMONN_FEEDBACK_RARE__": "correct-rare.mp3",
    "__KAKOMONN_FEEDBACK_SUPER_RARE__": "correct-super-rare.mp3",
    "__KAKOMONN_FEEDBACK_SSR__": "correct-ssr.mp3",
    "__KAKOMONN_FEEDBACK_INCORRECT__": "incorrect.mp3",
}


def render_userscript(parts: list[Path]) -> bytes:
    source = "".join(part.read_text(encoding="utf-8") for part in parts)
    for placeholder, asset_name in FEEDBACK_ASSETS.items():
        placeholder_count = source.count(placeholder)
        if placeholder_count != 1:
            raise RuntimeError(
                f"feedback asset placeholder must occur exactly once: "
                f"{placeholder} found {placeholder_count}"
            )
        encoded = base64.b64encode((ASSET_DIR / asset_name).read_bytes()).decode("ascii")
        source = source.replace(placeholder, encoded)
    placeholder_count = source.count(BUILD_FINGERPRINT_PLACEHOLDER)
    if placeholder_count != 1:
        raise RuntimeError(
            "build fingerprint placeholder must occur exactly once: "
            f"found {placeholder_count}"
        )

    fingerprint = hashlib.sha256(source.encode("utf-8")).hexdigest()
    return source.replace(BUILD_FINGERPRINT_PLACEHOLDER, fingerprint).encode("utf-8")


def main() -> None:
    actual_names = sorted(path.name for path in SOURCE_DIR.glob("*.js"))
    if actual_names != sorted(SOURCE_NAMES):
        raise RuntimeError(
            f"reader sources must match the manifest: expected {sorted(SOURCE_NAMES)}, "
            f"got {actual_names}"
        )
    parts = [SOURCE_DIR / name for name in SOURCE_NAMES]

    output = render_userscript(parts)
    if not output.startswith(b"// ==UserScript=="):
        raise RuntimeError("generated output does not start with a userscript header")
    versions = VERSION_PATTERN.findall(output)
    if len(versions) != 1:
        raise RuntimeError(
            "userscript must contain exactly one semantic @version: "
            f"found {len(versions)}"
        )

    OUTPUT_PATH.write_bytes(output)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
