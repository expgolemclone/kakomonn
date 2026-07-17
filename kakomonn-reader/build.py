from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "src"
OUTPUT_PATH = ROOT / "kakomonn-reader.user.js"


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

    output = "".join(part.read_text(encoding="utf-8") for part in parts)
    if not output.startswith("// ==UserScript=="):
        raise RuntimeError("generated output does not start with a userscript header")
    if "// @version" in output:
        raise RuntimeError("userscript version metadata must not be added")

    OUTPUT_PATH.write_bytes(output.encode("utf-8"))
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
