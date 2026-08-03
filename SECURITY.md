# Security policy

## Supported version

RoundLab does not publish versioned releases. Only the current `main` branch and the site deployed
from it receive security fixes. Historical commits are not supported.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

1. open the **Security** tab;
2. choose **Report a vulnerability**;
3. describe the impact, affected area and the smallest safe reproduction you can provide.

Do not open a public issue for an undisclosed vulnerability. If GitHub does not offer the private
report form, contact the repository owner through their GitHub profile without publishing the
technical details.

## Data that must not be attached

Never attach a private GOTV demo, full replay export, browser storage dump, Steam ID, player name,
local filesystem path, session token or other personal data. Prefer a synthetic fixture and redact
screenshots. CS2 demos can contain persistent player identifiers even when their filename looks
anonymous.

RoundLab's downloadable diagnostic intentionally excludes raw error messages, stacks, demos,
frames, player identities and local paths. Include that diagnostic when it is sufficient.

## Scope and response

The local parser, WASM/Worker boundary, IndexedDB storage, backup restore, static deployment and
GitHub Actions supply chain are in scope. The maintainer will acknowledge a valid private report,
assess severity and coordinate disclosure. No response-time SLA is promised for this
single-maintainer project.
