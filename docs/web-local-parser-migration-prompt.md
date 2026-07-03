# RoundLab Web Local Parser Migration

This document records the current migration target after removing the native
desktop runtime.

## Current Target

- RoundLab is a browser-based Next.js app.
- Demo parsing happens locally on the user's machine.
- Demo bytes are not uploaded to a server.
- The Rust parser is compiled to WebAssembly and runs in a Web Worker.
- `.dem.zst` decompression happens in the browser before parsing.
- Parsed match metadata and split round payloads are stored in browser storage.
- The replay JSON contract remains stable: `meta`, `players`, manifest
  `rounds`, split round files, and per-round `frames`, `events`, `effects`,
  `weaponFires`, and `projectileFrames`.

## Non-Goals

- No server-side demo parser.
- No cloud upload of demos.
- No parser streaming rewrite for the first web pass.
- No replay fidelity reduction to make the web port easier.
- No desktop runtime compatibility requirement.

## Validation Focus

- Normal browsers can open the app without native APIs.
- A user can select or drag/drop a local `.dem` or `.dem.zst`.
- Parsing runs locally in a worker and can open real large demos.
- Rounds load on demand from browser storage.
- The replay viewer opens parsed matches with full-quality replay data.
- The import flow checks for Web Workers, WebAssembly, IndexedDB, File API, and
  `crypto.randomUUID` before starting the parser.
- Chrome is the current proven browser. Edge and Safari still need explicit
  browser-specific validation before claiming broad production support.

## Known Risks

- Browser memory can still be a hard limit on very large demos.
- Safari may behave worse than Chromium for WebAssembly memory and storage.
- Safari WebDriver validation needs Safari Settings → Developer → Allow Remote
  Automation enabled before `safaridriver` can create a session.
- Worker transfer/copy costs are not optimized yet.
- Storage quota behavior needs production UX before users parse many matches.
