# Security & release procedure

This file documents how the Tauri updater is signed, where the keys live, and
when they must be rotated. It is the single source of truth for the release
chain — if this contradicts another doc, this one wins.

## Key separation

| Key            | Where it MUST live                                  | Where it MUST NOT live                |
|----------------|-----------------------------------------------------|---------------------------------------|
| Public key     | `desktop/src-tauri/tauri.conf.json` → `updater.pubkey` | Anywhere a third party cannot read it |
| Private key    | Secret manager (1Password, GitHub Actions secrets, …) | The repo, the workspace, build outputs, chat logs, screenshots, backups |

The public key is what every installed client uses to verify update signatures.
The private key is what signs releases. They are asymmetric: leaking the public
key is fine; leaking the private key means an attacker can sign updates that
every existing install will accept.

## Local workspace state

`.tauri-keys/` is gitignored (see `.gitignore`). The local copy of the private
key in that directory is for one-off manual builds only. It is **not** the
release-chain source of truth — CI must use its own copy from a secret manager.

If the local directory has ever been:

- shared (Slack, email, screen recording, pair-programming session, …),
- copied to another machine,
- archived alongside the workspace (zip, backup tool, time machine snapshot
  inspected by a third party),
- committed to ANY git repo, even temporarily,

→ **rotate the keypair** (see "Rotation" below). Treat any uncertainty as a
leak. The cost of rotation is small; the cost of a silent compromise is total.

## Releasing a signed build

1. Build the artifact in CI (no human touches the private key).
2. CI pulls the private key from its secret store into a process-scoped env
   var, signs the artifact, then drops the variable. The key never lands on
   disk in CI workspace.
3. CI uploads the artifact and `latest.json` (with signature) to the release
   target (GitHub Releases).
4. CI verifies end-to-end by downloading `latest.json` and checking the
   signature against the public key from `tauri.conf.json`. If verification
   fails, the release is aborted.

For a manual release from a developer machine (escape hatch only — discouraged):

1. Confirm the local `.tauri-keys/` keypair matches the `pubkey` in
   `tauri.conf.json`. If unsure, rotate.
2. Sign and publish.
3. Immediately re-rotate if the key was used outside its normal CI lane (the
   point above is to limit the blast radius of an exposed dev machine).

## Rotation

To rotate:

1. Generate a new keypair: `pnpm tauri signer generate -w .tauri-keys/roundlab.key`
2. Replace `updater.pubkey` in `desktop/src-tauri/tauri.conf.json` with the new
   public key.
3. Upload the new private key to the secret manager / CI secret store.
4. Delete the local private key from `.tauri-keys/` and from any other machine
   that ever held it. `srm` / `rm -P` if available; otherwise `rm` and accept
   that the SSD wear-levelling may keep traces.
5. Cut a new release signed with the new key. Existing installs will accept
   updates signed with the new public key once they upgrade past the version
   shipped with the new `tauri.conf.json`.
6. **Pre-rotation installs are stuck on the old key.** They will not accept
   updates signed with the new key. Plan a forced-update or out-of-band
   migration if you cannot afford to leave them behind.

## Audit trail

When in doubt about whether a rotation is needed, document the decision (here,
in a PR description, or in a security log) so future-you knows what state the
keypair is in. "I think it's fine" without evidence is not an answer.

## Out of scope (intentionally)

This document does not cover:

- CSP hardening (`security.csp` is currently `null` in `tauri.conf.json`)
- Tauri capability/permissions tightening
- Code signing for the Windows/macOS installer itself (separate from the
  updater signature)

Those are tracked in the audit and need their own pass.
