from __future__ import annotations

import json
from pathlib import Path


EXTENSION_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = EXTENSION_ROOT.parent
SOURCE_PATH = EXTENSION_ROOT / "src" / "userscript.js"
PROMPT_PATH = REPOSITORY_ROOT / "system-prompt.md"
OUTPUT_PATH = EXTENSION_ROOT / "chatgpt-initial-prompt.user.js"
PROMPT_PLACEHOLDER = "__SYSTEM_PROMPT_JSON__"


def main() -> None:
    source = SOURCE_PATH.read_text(encoding="utf-8")
    prompt = PROMPT_PATH.read_text(encoding="utf-8")

    if source.count(PROMPT_PLACEHOLDER) != 1:
        raise RuntimeError("userscript source must contain exactly one prompt placeholder")
    if not prompt.strip():
        raise RuntimeError("system prompt must not be empty")

    embedded_prompt = json.dumps(prompt, ensure_ascii=False)
    output = source.replace(PROMPT_PLACEHOLDER, embedded_prompt)
    if not output.startswith("// ==UserScript=="):
        raise RuntimeError("generated output does not start with a userscript header")
    if PROMPT_PLACEHOLDER in output:
        raise RuntimeError("prompt placeholder remains in generated output")
    if output.count(embedded_prompt) != 1:
        raise RuntimeError("system prompt was not embedded exactly once")

    OUTPUT_PATH.write_text(output, encoding="utf-8")
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
