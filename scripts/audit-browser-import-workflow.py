#!/usr/bin/env python3
"""Audit the browser import-to-review workflow contract.

Other audits cover parser locality, progress, and storage internals. This one
guards the user-facing flow: select/drop a local demo, parse it, refresh recent
matches, optionally rename it, and open the parsed match in the review screen.
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "desktop" / "src" / "app" / "page.tsx"
BACKEND = ROOT / "desktop" / "src" / "lib" / "backends" / "browser.ts"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def balanced_block_after(source: str, marker: str, opener: str = "{", closer: str = "}") -> str:
    start = source.find(marker)
    if start < 0:
        raise AssertionError(f"missing marker {marker!r}")
    open_at = source.find(opener, start + len(marker))
    if open_at < 0:
        raise AssertionError(f"missing opener after marker {marker!r}")
    depth = 0
    for index in range(open_at, len(source)):
        char = source[index]
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return source[open_at + 1:index]
    raise AssertionError(f"unterminated block after marker {marker!r}")


def function_body(source: str, name: str) -> str:
    match = re.search(rf"(?:function|const)\s+{re.escape(name)}\b", source)
    if not match:
        raise AssertionError(f"missing function/const {name}")
    if match.group(0).startswith("function"):
        paren = source.find("(", match.end())
        if paren < 0:
            raise AssertionError(f"missing parameter list for {name}")
        depth = 0
        end_paren = -1
        for index in range(paren, len(source)):
            char = source[index]
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    end_paren = index
                    break
        if end_paren < 0:
            raise AssertionError(f"unterminated parameter list for {name}")
        return balanced_block_after(source[end_paren:], "", "{", "}")
    return balanced_block_after(source, match.group(0))


def assert_contains(label: str, source: str, tokens: list[str]) -> list[str]:
    return [f"{label} is missing {token!r}" for token in tokens if token not in source]


def assert_import_surface(page: str) -> list[str]:
    errors: list[str] = []
    errors.extend(
        assert_contains(
            "Home imports",
            page,
            [
                "useRouter",
                "cancelParse",
                "deleteMatch",
                "getMatchMetadata",
                "listMatches",
                "onParseProgress",
                "parseDemo",
                "renameMatch",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "demo file input",
            page,
            [
                'data-testid="demo-file-input"',
                'type="file"',
                'accept=".dem,.zst,.dem.zst"',
                "onChange={onFileSelected}",
                "ref={fileInputRef}",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "drop/click import surface",
            page,
            [
                "onClick={onPickAndParse}",
                "onKeyDown={onImportKeyDown}",
                "onDragEnter",
                "onDragOver",
                "onDragLeave",
                "onDrop={onBrowserDrop}",
                'role="button"',
                "tabIndex={0}",
            ],
        )
    )
    return errors


def assert_pick_file_and_drop_guards(page: str) -> list[str]:
    errors: list[str] = []
    pick = function_body(page, "onPickAndParse")
    errors.extend(
        assert_contains(
            "onPickAndParse",
            pick,
            [
                "if (uploading) return",
                "const supportError = browserSupportError()",
                "setError(supportError)",
                "fileInputRef.current?.click()",
            ],
        )
    )
    selected = function_body(page, "onFileSelected")
    errors.extend(
        assert_contains(
            "onFileSelected",
            selected,
            [
                "event.currentTarget.files?.[0]",
                'event.currentTarget.value = ""',
                "if (!file || uploading) return",
                "const supportError = browserSupportError()",
                "if (!isDemoFile(file))",
                'setError("Choose a .dem or .dem.zst file.")',
                'parseSource({ kind: "file", file })',
            ],
        )
    )
    drop = function_body(page, "onBrowserDrop")
    errors.extend(
        assert_contains(
            "onBrowserDrop",
            drop,
            [
                "event.preventDefault()",
                "setDragging(false)",
                "if (uploading) return",
                "const supportError = browserSupportError()",
                "Array.from(event.dataTransfer.files).find(isDemoFile)",
                'setError("Drop a .dem or .dem.zst file.")',
                'parseSource({ kind: "file", file })',
            ],
        )
    )
    keydown = function_body(page, "onImportKeyDown")
    errors.extend(assert_contains("onImportKeyDown", keydown, ['event.key !== "Enter"', 'event.key !== " "', "onPickAndParse()"]))
    path = function_body(page, "isDemoPath")
    errors.extend(assert_contains("isDemoPath", path, ['endsWith(".dem")', 'endsWith(".dem.zst")', 'endsWith(".zst")']))
    return errors


def assert_parse_success_progress_and_cancel(page: str, backend: str) -> list[str]:
    errors: list[str] = []
    parse = function_body(page, "parseSource")
    errors.extend(
        assert_contains(
            "parseSource",
            parse,
            [
                "if (uploading) return",
                "setUploading(true)",
                "setParseStartedAt(started)",
                "setParseProgress({ phase: \"starting\", progress: 0.02, message: \"Preparing parser…\" })",
                "const id = await parseDemo(source)",
                "saveParseEstimate(source, duration, parseEffectiveBytesRef.current)",
                "const items = await listMatches().catch(() => [] as MatchSummary[])",
                "setMatches(items)",
                "items.find((m) => m.id === id)",
                "setPostParseName(\"\")",
                "setPostParse(summary)",
                "setUploading(false)",
                "setParseStartedAt(null)",
                "parseEffectiveBytesRef.current = null",
                "parseMinMsPerMbRef.current = 0",
                "setParseProgress({ phase: \"idle\", progress: 0, message: \"\" })",
            ],
        )
    )
    errors.extend(assert_contains("parseSource cancel suppression", parse, ["if (!/cancel/i.test(message)) setError(message)"]))
    progress_effect = balanced_block_after(page, "onParseProgress((progress) =>")
    errors.extend(
        assert_contains(
            "onParseProgress subscription",
            progress_effect,
            [
                "progress.effectiveBytes",
                "parseEffectiveBytesRef.current = progress.effectiveBytes",
                "setParseEstimateMs",
                "setParseProgress(progress)",
            ],
        )
    )
    cancel = function_body(page, "onCancelParse")
    errors.extend(assert_contains("onCancelParse", cancel, ["await cancelParse()", "setError(e instanceof Error ? e.message : String(e))"]))
    backend_cancel = balanced_block_after(backend, "async cancelParse()")
    errors.extend(
        assert_contains(
            "browser backend cancelParse",
            backend_cancel,
            [
                "activeWorker?.terminate()",
                'activeReject?.(new Error("Browser parse cancelled."))',
                "activeWorker = null",
                "activeReject = null",
                'progressBus.emit({ phase: "cancelled", progress: 0, message: "Cancelled." })',
            ],
        )
    )
    backend_parse = balanced_block_after(backend, "async parseDemo(source: DemoSource, options)")
    errors.extend(
        assert_contains(
            "browser backend parse cleanup",
            backend_parse,
            [
                "activeWorker = worker",
                "activeReject = reject",
                "activeWorker = null",
                "activeReject = null",
                "worker.terminate()",
            ],
        )
    )
    return errors


def assert_post_parse_open_rename_delete(page: str) -> list[str]:
    errors: list[str] = []
    open_match = function_body(page, "openMatch")
    errors.extend(
        assert_contains(
            "openMatch",
            open_match,
            [
                "if (uploading) return",
                "setOpening(true)",
                "await getMatchMetadata(id)",
                "router.push(`/match/?id=${id}${visualTest ? \"&visualTest=1\" : \"\"}`)",
            ],
        )
    )
    post = function_body(page, "confirmPostParse")
    errors.extend(
        assert_contains(
            "confirmPostParse",
            post,
            [
                "const target = postParse",
                "const next = postParseName.trim()",
                "setPostParse(null)",
                "const updated = await renameMatch(target.id, next)",
                "setMatches((items) =>",
                "if (open) await openMatch(target.id, false)",
            ],
        )
    )
    rename = function_body(page, "confirmRename")
    errors.extend(
        assert_contains(
            "confirmRename",
            rename,
            [
                "const target = renameTarget",
                "const next = renameValue.trim()",
                "const updated = await renameMatch(target.id, next)",
                "setMatches((items) => items.map((m) => (m.id === target.id ? updated : m)))",
            ],
        )
    )
    delete = function_body(page, "confirmDelete")
    errors.extend(
        assert_contains(
            "confirmDelete",
            delete,
            [
                "const target = deleteTarget",
                "await deleteMatch(target.id)",
                "setMatches((items) => items.filter((m) => m.id !== target.id))",
            ],
        )
    )
    match_row = function_body(page, "MatchRow")
    errors.extend(
        assert_contains(
            "MatchRow",
            match_row,
            [
                "onClick={onOpen}",
                "onClick={(e) => e.stopPropagation()}",
                "onClick={(e) => e.stopPropagation()}",
                "DropdownMenuItem onClick={onRename}",
                "onClick={onDelete}",
            ],
        )
    )
    return errors


def assert_modals_keep_keyboard_flow(page: str) -> list[str]:
    errors: list[str] = []
    errors.extend(
        assert_contains(
            "post-parse modal",
            page,
            [
                "{postParse && (",
                'title="Match parsed"',
                "void confirmPostParse(true)",
                "void confirmPostParse(false)",
                "placeholder={postParse.name}",
            ],
        )
    )
    modal = function_body(page, "Modal")
    errors.extend(
        assert_contains(
            "Modal",
            modal,
            [
                "panelRef.current?.focus()",
                "onClick={onClose}",
                "onKeyDownCapture",
                "e.stopPropagation()",
                'e.key === "Escape"',
                "onClick={(e) => e.stopPropagation()}",
            ],
        )
    )
    return errors


def main() -> None:
    page = read(PAGE)
    backend = read(BACKEND)
    errors: list[str] = []
    errors.extend(assert_import_surface(page))
    errors.extend(assert_pick_file_and_drop_guards(page))
    errors.extend(assert_parse_success_progress_and_cancel(page, backend))
    errors.extend(assert_post_parse_open_rename_delete(page))
    errors.extend(assert_modals_keep_keyboard_flow(page))
    if errors:
        raise AssertionError("browser import workflow audit failed: " + "; ".join(errors))
    print("browser import workflow audit passed")


if __name__ == "__main__":
    main()
