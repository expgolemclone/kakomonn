from __future__ import annotations

import json
from pathlib import Path


EXTENSION_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = EXTENSION_ROOT.parent
SOURCE_PATH = EXTENSION_ROOT / "src" / "userscript.js"
PROMPT_PATH = REPOSITORY_ROOT / "system-prompt.md"
OUTPUT_PATH = EXTENSION_ROOT / "chatgpt-initial-prompt.user.js"
PROMPT_PLACEHOLDER = "__SYSTEM_PROMPT_JSON__"


def main() -> None:
    source = SOURCE_PATH.read_text(encoding="utf-8")
    prompt = PROMPT_PATH.read_text(encoding="utf-8")
    output = OUTPUT_PATH.read_text(encoding="utf-8")
    embedded_prompt = json.dumps(prompt, ensure_ascii=False)
    expected = source.replace(PROMPT_PLACEHOLDER, embedded_prompt)

    assert output == expected, (
        "chatgpt-initial-prompt.user.js is not the current self-contained build"
    )
    assert output.count(embedded_prompt) == 1, (
        "system prompt must be embedded exactly once"
    )
    assert PROMPT_PLACEHOLDER not in output, (
        "prompt placeholder must not remain in the generated userscript"
    )
    print("ChatGPT initial prompt self-contained build test passed")


if __name__ == "__main__":
    main()
