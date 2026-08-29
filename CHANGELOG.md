# Changelog

## [Unreleased]

### Added

- **Platform view** — browse Rules, Connector functions, Provision functions and
  Workspaces on the tenant; click one to open it if it is already in the
  workspace, or pull it if it is not.
- **Binary management** — finds `og` on `PATH` or at `og.path`, and offers to
  download the right build when there is none, verifying its SHA-256 against the
  release's `checksums.txt`. Reports an og older than 2.2.0, which lacks the
  `show --path` the diff depends on.
- **Diff against the platform** — VS Code's own diff between a file and its
  remote content, through an `og-remote:` document provider.
- **What deploying would change** — `og diff`'s own rendering of the whole
  artifact, metadata included.
- **Validation as diagnostics** — `og validate` findings in the Problems panel,
  on save and on demand.
- **Deploy**, with the diff shown and a confirmation asked first.
- **Regenerate editor typings** for the current artifact.
