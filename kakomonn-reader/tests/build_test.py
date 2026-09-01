from __future__ import annotations

import base64
import hashlib
import runpy
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "build.py"
SOURCE_DIR = ROOT / "src"
OUTPUT_PATH = ROOT / "kakomonn-reader.user.js"
BUILD_FINGERPRINT_PLACEHOLDER = "__KAKOMONN_READER_BUILD_FINGERPRINT__"


def main() -> None:
    subprocess.run([sys.executable, str(BUILD_SCRIPT)], check=True)

    build_globals = runpy.run_path(str(BUILD_SCRIPT))
    source_names = build_globals["SOURCE_NAMES"]
    asset_dir = build_globals["ASSET_DIR"]
    feedback_assets = build_globals["FEEDBACK_ASSETS"]
    source = "".join(
        (SOURCE_DIR / name).read_text(encoding="utf-8") for name in source_names
    )
    for placeholder, asset_name in feedback_assets.items():
        if source.count(placeholder) != 1:
            raise AssertionError(
                f"feedback placeholder must occur exactly once: {placeholder}"
            )
        encoded = base64.b64encode((asset_dir / asset_name).read_bytes()).decode(
            "ascii"
        )
        source = source.replace(placeholder, encoded)
    if source.count(BUILD_FINGERPRINT_PLACEHOLDER) != 1:
        raise AssertionError("build fingerprint placeholder must occur exactly once")
    fingerprint = hashlib.sha256(source.encode("utf-8")).hexdigest()
    expected = source.replace(BUILD_FINGERPRINT_PLACEHOLDER, fingerprint).encode(
        "utf-8"
    )
    actual = OUTPUT_PATH.read_bytes()

    if b"\r\n" in actual:
        raise AssertionError("build output must use LF line endings")
    if actual != expected:
        raise AssertionError(
            "build output must be the exact fingerprint-injected source join"
        )
    if fingerprint.encode("ascii") not in actual:
        raise AssertionError("build output must contain its source fingerprint")
    if actual.count(b"data:audio/mpeg;base64,") != len(feedback_assets):
        raise AssertionError("build output must contain every bundled feedback asset")

    print("kakomonn reader reproducible build test passed")


if __name__ == "__main__":
    main()
