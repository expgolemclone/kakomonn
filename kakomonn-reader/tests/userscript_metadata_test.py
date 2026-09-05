"""Validate metadata in the generated kakomonn-reader userscript."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
import sys


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]

HEADER_START = "// ==UserScript=="
HEADER_END = "// ==/UserScript=="
DIRECTIVE_PATTERN = re.compile(
    r"//[ \t]+@(?P<key>[A-Za-z][A-Za-z0-9:-]*)(?:[ \t]+(?P<value>.*?))?[ \t]*"
)
MATCH_PATTERN = re.compile(
    r"(?:\*|https?|http\*)://(?:\*|\*\.[^/*\s]+|[^/*\s]+)/\S*"
)
EXPECTED_MATCH_VALUES = {
    "https://*.kakomonn.com/*",
    "https://kakomonn-sync.kakomonn.workers.dev/open",
}

# https://www.tampermonkey.net/documentation.php#meta:script
SUPPORTED_DIRECTIVES = frozenset(
    {
        "antifeature",
        "author",
        "connect",
        "copyright",
        "defaulticon",
        "description",
        "downloadURL",
        "exclude",
        "grant",
        "homepage",
        "homepageURL",
        "icon",
        "icon64",
        "icon64URL",
        "iconURL",
        "include",
        "match",
        "name",
        "namespace",
        "noframes",
        "require",
        "resource",
        "run-at",
        "run-in",
        "sandbox",
        "source",
        "supportURL",
        "tag",
        "unwrap",
        "updateURL",
        "version",
        "webRequest",
        "website",
    }
)
LOCALIZABLE_DIRECTIVES = frozenset({"description", "name"})
VALUELESS_DIRECTIVES = frozenset({"noframes", "unwrap"})
RUN_AT_VALUES = frozenset(
    {
        "context-menu",
        "document-body",
        "document-end",
        "document-idle",
        "document-start",
    }
)
VERSION_PATTERN = re.compile(r"\d+\.\d+\.\d+")
UPDATE_URL = (
    "https://github.com/expgolemclone/kakomonn/releases/latest/download/"
    "kakomonn-reader.user.js"
)


def extract_metadata(script: str) -> dict[str, list[str | None]]:
    lines = script.splitlines()
    assert lines, "userscript is empty"
    assert lines[0] == HEADER_START, "userscript header must start at the first line"

    try:
        end_index = lines.index(HEADER_END, 1)
    except ValueError as error:
        raise AssertionError("userscript header end marker was not found") from error

    assert end_index > 1, "userscript header has no metadata"
    assert end_index + 1 < len(lines), "userscript body was not found"
    assert lines[end_index + 1] == "", "userscript header and body must be separated"

    metadata: defaultdict[str, list[str | None]] = defaultdict(list)
    for line_number, line in enumerate(lines[1:end_index], start=2):
        match = DIRECTIVE_PATTERN.fullmatch(line)
        assert match is not None, f"invalid metadata syntax at line {line_number}: {line}"

        key = match.group("key")
        value = match.group("value")
        base_key, separator, _locale = key.partition(":")
        assert base_key in SUPPORTED_DIRECTIVES, (
            f"unsupported Tampermonkey metadata directive at line {line_number}: @{key}"
        )
        assert not separator or base_key in LOCALIZABLE_DIRECTIVES, (
            f"metadata directive does not support a locale at line {line_number}: @{key}"
        )

        if base_key in VALUELESS_DIRECTIVES:
            assert value is None, f"@{key} must not have a value"
        else:
            assert value is not None and value.strip(), f"@{key} requires a value"

        metadata[key].append(value)

    return dict(metadata)


def require_single_value(
    metadata: dict[str, list[str | None]], key: str
) -> str:
    values = metadata.get(key, [])
    assert len(values) == 1, f"@{key} must occur exactly once"
    value = values[0]
    assert value is not None
    return value


def validate(script_path: Path) -> None:
    script = script_path.read_text(encoding="utf-8")
    metadata = extract_metadata(script)

    require_single_value(metadata, "name")
    require_single_value(metadata, "namespace")
    require_single_value(metadata, "description")

    match_values = metadata.get("match", [])
    assert match_values, "at least one @match directive is required"
    for value in match_values:
        assert value is not None and MATCH_PATTERN.fullmatch(value), (
            f"invalid Tampermonkey @match pattern: {value}"
        )
    assert set(match_values) == EXPECTED_MATCH_VALUES, (
        f"unexpected Tampermonkey @match patterns: {match_values}"
    )

    run_at = require_single_value(metadata, "run-at")
    assert run_at in RUN_AT_VALUES, f"unsupported Tampermonkey @run-at value: {run_at}"
    assert "noframes" not in metadata, "reader must run in its question iframe"

    grant_values = metadata.get("grant", [])
    assert grant_values, "at least one @grant directive is required"
    assert "none" not in grant_values or grant_values == ["none"], (
        "@grant none cannot be combined with other grants"
    )

    version = require_single_value(metadata, "version")
    assert VERSION_PATTERN.fullmatch(version), f"invalid semantic @version: {version}"
    assert require_single_value(metadata, "updateURL") == UPDATE_URL
    assert require_single_value(metadata, "downloadURL") == UPDATE_URL
    print(f"userscript metadata test passed: {script_path}")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("at least one userscript path is required")
    for argument in sys.argv[1:]:
        script_path = (REPOSITORY_ROOT / argument).resolve()
        assert script_path.is_relative_to(REPOSITORY_ROOT), (
            f"userscript path must stay inside the repository: {argument}"
        )
        validate(script_path)


if __name__ == "__main__":
    main()
