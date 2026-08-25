from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "src"
OUTPUT_PATH = ROOT / "kakomonn-reader.user.js"
BUILD_FINGERPRINT_PLACEHOLDER = "__KAKOMONN_READER_BUILD_FINGERPRINT__"
SOURCE_NAMES = (
    "metadata-and-runtime.js",
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


def render_userscript(parts: list[Path]) -> bytes:
    source = "".join(part.read_text(encoding="utf-8") for part in parts)
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
    if b"// @version" in output:
        raise RuntimeError("userscript version metadata must not be added")

    OUTPUT_PATH.write_bytes(output)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
