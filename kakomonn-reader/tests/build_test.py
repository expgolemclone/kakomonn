from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "build.py"
SOURCE_DIR = ROOT / "src"
OUTPUT_PATH = ROOT / "kakomonn-reader.user.js"


def main() -> None:
    subprocess.run([sys.executable, str(BUILD_SCRIPT)], check=True)

    expected = "".join(
        part.read_text(encoding="utf-8")
        for part in sorted(SOURCE_DIR.glob("part-*.js"))
    ).encode("utf-8")
    actual = OUTPUT_PATH.read_bytes()

    if b"\r\n" in actual:
        raise AssertionError("build output must use LF line endings")
    if actual != expected:
        raise AssertionError("build output must be the exact LF-normalized source join")

    print("kakomonn reader reproducible build test passed")


if __name__ == "__main__":
    main()
