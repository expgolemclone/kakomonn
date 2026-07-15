from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE_PATH = ROOT / "src" / "userscript.js"
PROMPT_PATH = ROOT / "system-prompt.md"
OUTPUT_PATH = ROOT / "gai.user.js"
PROMPT_PLACEHOLDER = "__SYSTEM_PROMPT_JSON__"


def main() -> None:
    source = SOURCE_PATH.read_text(encoding="utf-8")
    prompt = PROMPT_PATH.read_text(encoding="utf-8")

    if source.count(PROMPT_PLACEHOLDER) != 1:
        raise RuntimeError("userscript source must contain exactly one prompt placeholder")
    if not prompt.strip():
        raise RuntimeError("system prompt must not be empty")

    output = source.replace(
        PROMPT_PLACEHOLDER,
        json.dumps(prompt, ensure_ascii=False),
    )
    if not output.startswith("// ==UserScript=="):
        raise RuntimeError("generated output does not start with a userscript header")
    if "// @version" in output:
        raise RuntimeError("userscript version metadata must not be added")
    if PROMPT_PLACEHOLDER in output:
        raise RuntimeError("prompt placeholder remains in generated output")

    OUTPUT_PATH.write_text(output, encoding="utf-8")
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
