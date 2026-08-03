from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "monitor_production",
    ROOT / "scripts" / "monitor-production.py",
)
assert SPEC and SPEC.loader
MONITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONITOR)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


class ProductionMonitorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        (self.root / "feedback").mkdir()
        (self.root / "assets").mkdir()
        (self.root / "index.html").write_text("<title>RoundLab</title>", encoding="utf-8")
        (self.root / "feedback" / "index.html").write_text("Signaler un problème", encoding="utf-8")
        self.wasm = b"\x00asm" + bytes(range(64))
        (self.root / "assets" / "parser.wasm").write_bytes(self.wasm)
        self.write_manifest(hashlib.sha256(self.wasm).hexdigest())

        handler = lambda *args, **kwargs: QuietHandler(*args, directory=self.root, **kwargs)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def write_manifest(self, sha256: str) -> None:
        manifest = {
            "schemaVersion": 1,
            "application": "RoundLab",
            "version": "test",
            "commit": "a" * 40,
            "generatedAt": "2026-08-03T00:00:00Z",
            "routes": {"home": "./", "feedback": "feedback/"},
            "wasm": {
                "path": "assets/parser.wasm",
                "bytes": len(self.wasm),
                "sha256": sha256,
            },
        }
        (self.root / "health.json").write_text(json.dumps(manifest), encoding="utf-8")

    def test_reports_all_production_surfaces_as_available(self) -> None:
        report = MONITOR.run_monitor(self.url, warning_ms=10_000, critical_ms=20_000)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(
            [check["name"] for check in report["checks"]],
            ["home", "feedback", "health-manifest", "parser-wasm"],
        )

    def test_fails_when_the_wasm_integrity_does_not_match(self) -> None:
        self.write_manifest("0" * 64)
        report = MONITOR.run_monitor(self.url, warning_ms=10_000, critical_ms=20_000)
        self.assertEqual(report["status"], "failed")
        wasm = next(check for check in report["checks"] if check["name"] == "parser-wasm")
        self.assertIn("SHA-256", wasm["error"])

    def test_fails_when_a_required_route_is_missing(self) -> None:
        (self.root / "feedback" / "index.html").unlink()
        (self.root / "feedback").rmdir()
        report = MONITOR.run_monitor(self.url, warning_ms=10_000, critical_ms=20_000)
        self.assertEqual(report["status"], "failed")
        feedback = next(check for check in report["checks"] if check["name"] == "feedback")
        self.assertIn("HTTP 404", feedback["error"])


if __name__ == "__main__":
    unittest.main()
