# Changelog

## 0.4.0

**Requires og 2.4.0.**

### Added

- **Widgets are editable like anything else.** Diff a widget's formatter against
  the platform, see what deploying its dashboard would change, and deploy —
  none of which was possible before, because og had no way to read one widget
  file back or to compare a single dashboard. og 2.4.0 adds
  `og dashboard show --path` and `og dashboard diff`, and this extension is a
  pass-through to them.
- A widget deploys **as its dashboard**, which is the smallest unit the platform
  can address, and the confirmation says so before it sends anything. Same
  boundary `og watch` already drew.

### Fixed

- **The minimum version said 2.2.0 while 0.3.0 needed 2.3.0** for `whoami`. An og
  between the two was accepted silently and then failed its session check with no
  explanation.
- **Diff on a widget or a dashboard reported "unknown flag: --path"** — an error
  about the extension's own invocation, which told the reader nothing.
- **"What deploying this artifact would change" showed a help page on a widget or
  a dashboard**, and **deploying a dashboard asked for confirmation against that
  same help page** — a real write confirmed against a preview that was not one.
  `og dashboard diff` did not exist, and cobra answers a subcommand it does not
  have with the family's help and exit 0, so nothing looked wrong.

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
