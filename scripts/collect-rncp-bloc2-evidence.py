#!/usr/bin/env python3
"""Run reproducible Bloc 2 checks and write their raw evidence logs."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import platform
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
PARSER = ROOT / "parser"
EVIDENCE = ROOT / "docs" / "rncp-bloc2" / "evidence"
LOGS = EVIDENCE / "logs"


def command_text(command: list[str]) -> str:
    return " ".join(command)


def run_check(name: str, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> tuple[str, int]:
    result = subprocess.run(
        command,
        cwd=cwd,
        env={**os.environ, **(env or {})},
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    # Preserve the command output while removing terminal padding that would
    # otherwise make the generated evidence fail `git diff --check`.
    clean_stdout = "\n".join(line.rstrip() for line in result.stdout.splitlines())
    log = f"$ {command_text(command)}\n\n{clean_stdout}\n\nexit_code={result.returncode}\n"
    (LOGS / f"{name}.txt").write_text(log, encoding="utf-8")
    return ("PASS" if result.returncode == 0 else "FAIL", result.returncode)


def version(command: list[str], cwd: Path = ROOT) -> str:
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    return (result.stdout or result.stderr).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", type=Path, help="local .dem or .dem.zst used for the real replay snapshot check")
    args = parser.parse_args()

    LOGS.mkdir(parents=True, exist_ok=True)
    generated_at = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    git_status = version(["git", "status", "--short"])
    environment = [
        f"generated_at={generated_at}",
        f"platform={platform.platform()}",
        f"git_base_head={version(['git', 'rev-parse', 'HEAD'])}",
        f"git_worktree={'dirty' if git_status else 'clean'}",
        f"node={version(['node', '--version'])}",
        f"pnpm={version(['pnpm', '--version'])}",
        f"rustc={version(['rustc', '--version'])}",
        f"cargo={version(['cargo', '--version'])}",
        f"cargo_audit={version(['cargo', 'audit', '--version'])}",
        f"cargo_llvm_cov={version(['cargo', 'llvm-cov', '--version'])}",
    ]
    if git_status:
        environment.extend(["git_status_short_begin", git_status, "git_status_short_end"])
    (EVIDENCE / "environment.txt").write_text("\n".join(environment) + "\n", encoding="utf-8")

    checks = [
        ("frontend-dependency-audit", ["pnpm", "audit", "--audit-level", "high"], DESKTOP, None),
        ("frontend-lint", ["pnpm", "lint"], DESKTOP, None),
        ("frontend-typecheck", ["pnpm", "exec", "tsc", "--noEmit"], DESKTOP, None),
        ("frontend-coverage", ["pnpm", "test:coverage"], DESKTOP, None),
        ("frontend-build", ["pnpm", "build"], DESKTOP, None),
        ("frontend-performance-budgets", ["python3", "scripts/check-performance-budgets.py"], ROOT, None),
        ("browser-benchmark-evidence", ["python3", "scripts/summarize-browser-benchmark.py"], ROOT, None),
        ("frontend-e2e-accessibility", ["pnpm", "test:e2e:a11y"], DESKTOP, None),
        (
            "frontend-pages-build",
            ["pnpm", "build"],
            DESKTOP,
            {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "Lakav/RoundLab"},
        ),
        ("rust-format", ["cargo", "fmt", "--check"], PARSER, None),
        ("rust-tests", ["cargo", "test"], PARSER, None),
        ("rust-wasm-check", ["cargo", "check", "--target", "wasm32-unknown-unknown", "--lib"], PARSER, None),
        ("rust-clippy", ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], PARSER, None),
        ("rust-dependency-audit", ["cargo", "audit"], PARSER, None),
        ("portable-audits", ["python3", "scripts/run-local-ci-checks.py", "--skip-frontend"], ROOT, None),
        ("recipe-summary", ["python3", "scripts/summarize-recipe.py"], ROOT, None),
        ("wasm-reproducibility", ["python3", "scripts/verify-wasm-reproducibility.py"], ROOT, None),
    ]

    results: list[tuple[str, str, str]] = []
    failed = False
    for name, command, cwd, env in checks:
        status, returncode = run_check(name, command, cwd, env)
        results.append((name, status, f"logs/{name}.txt (exit {returncode})"))
        failed |= returncode != 0

    if args.demo:
        demo = args.demo.expanduser().resolve()
        if demo.is_file():
            name = "rust-real-demo-reference"
            command = [
                "cargo",
                "test",
                "--release",
                "roundlab_test_demo_produces_replay_json_when_configured",
                "--lib",
                "--",
                "--nocapture",
            ]
            status, returncode = run_check(
                name,
                command,
                PARSER,
                {"ROUNDLAB_TEST_DEMOS": str(demo)},
            )
            results.append((name, status, f"logs/{name}.txt (exit {returncode})"))
            failed |= returncode != 0
            coverage_name = "rust-coverage"
            coverage_output = EVIDENCE / "coverage" / "rust" / "coverage-summary.json"
            coverage_output.parent.mkdir(parents=True, exist_ok=True)
            coverage_command = [
                "cargo",
                "llvm-cov",
                "--workspace",
                "--json",
                "--output-path",
                str(coverage_output),
            ]
            status, returncode = run_check(
                coverage_name,
                coverage_command,
                PARSER,
                {"ROUNDLAB_TEST_DEMOS": str(demo)},
            )
            results.append((coverage_name, status, f"coverage/rust/coverage-summary.json et logs/{coverage_name}.txt (exit {returncode})"))
            failed |= returncode != 0
        else:
            results.append(("rust-real-demo-reference", "BLOQUÉ", f"fixture introuvable: {demo}"))
            results.append(("rust-coverage", "BLOQUÉ", "fixture réelle indispensable à la mesure majoritaire"))
    else:
        results.append(("rust-real-demo-reference", "BLOQUÉ", "option --demo non fournie"))
        results.append(("rust-coverage", "BLOQUÉ", "option --demo non fournie"))

    lines = [
        "# Rapport d’exécution des contrôles",
        "",
        f"Généré le `{generated_at}`.",
        "",
        "| Contrôle | Statut | Preuve |",
        "| --- | --- | --- |",
        *[f"| `{name}` | **{status}** | `{proof}` |" for name, status, proof in results],
        "",
        "`BLOQUÉ` signifie que le contrôle n’a pas été exécuté ; il ne vaut jamais succès.",
        "",
        "## Vérifications distantes",
        "",
        "Les CI de PR et de `main`, les déploiements, les smokes publics, les rollbacks, les restaurations et le garde-fou strict sont consignés avec leurs URL et SHA dans `deployment-runs-2026-07-21.md`. Cette synthèse locale ne duplique pas leurs statuts et ne transforme pas l'échec attendu du garde-fou en échec technique.",
    ]
    (EVIDENCE / "execution-tests.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
