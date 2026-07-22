from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "src"
OUTPUT_PATH = ROOT / "kakomonn-reader.user.js"
BUILD_FINGERPRINT_PLACEHOLDER = "__KAKOMONN_READER_BUILD_FINGERPRINT__"


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
    parts = sorted(SOURCE_DIR.glob("part-*.js"))
    if not parts:
        raise RuntimeError("source parts were not found")

    expected_names = [f"part-{index:02d}.js" for index in range(len(parts))]
    actual_names = [part.name for part in parts]
    if actual_names != expected_names:
        raise RuntimeError(
            f"source parts must be contiguous: expected {expected_names}, got {actual_names}"
        )

    output = render_userscript(parts)
    if not output.startswith(b"// ==UserScript=="):
        raise RuntimeError("generated output does not start with a userscript header")
    if b"// @version" in output:
        raise RuntimeError("userscript version metadata must not be added")

    OUTPUT_PATH.write_bytes(output)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
