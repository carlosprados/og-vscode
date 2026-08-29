# Changelog

## 0.3.0

### Changed

- **The session is checked before the work, not after the failure.** Commands
  that need the platform ask `og whoami` first — local and instant, no request —
  and offer to log in when there is no session or it has expired, saying which.
  The Platform view shows the same under the family you expanded, with a way
  out, instead of a raw 401.
- Requires og 2.3.0 for `whoami`. An older one degrades to the previous
  behaviour rather than being blocked: a question that cannot be asked is not
  the same as a "no".


## 0.2.0

### Added

- **Logging in from the editor** — `og: Log in to OpenGate` collects credentials
  and runs `og login`. The extension stores nothing; og writes the token to its
  own profile. Any command failing with a 401 offers to log in rather than
  sending you to a terminal.
- **Right-click in the Platform view**, with entries that depend on whether the
  artifact is already in your workspace, and a marker in the tree showing which
  ones are.

### Changed

- The README is now a help page: a five-minute quick start covering install,
  log in and a first edit, plus a troubleshooting table.
- The icon is a globe.

### Fixed

- Diff invoked on an artifact rather than a file resolved the metadata file and
  refused. It now finds the code file, asking which when there is more than one.
- A diagnostic no longer prints the filename twice.

## 0.1.0

First release.

- **Platform view** — browse Rules, Connector functions, Provision functions and
  Workspaces on the tenant; click to open or pull.
- **Binary management** — finds `og` on `PATH` or at `og.path`, and offers to
  download the right build when there is none, verifying its SHA-256 against the
  release's `checksums.txt`.
- **Diff against the platform** through an `og-remote:` document provider.
- **What deploying would change** — `og diff`'s own rendering.
- **Validation as diagnostics**, on save and on demand.
- **Deploy**, with the diff shown and confirmation asked first.
- **Regenerate editor typings**.
