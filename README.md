# OpenGate (og) for VS Code

Edit OpenGate artifacts — automation rules, connector functions, provision
functions, dashboards and widgets — against a live platform, without leaving the
editor.

> **Unofficial community project.** Not an Amplía Soluciones product, not
> supported by Amplía, and provided with no warranty. It drives the
> [`og`](https://github.com/carlosprados/og-cli) CLI, which can write to a
> production OpenGate tenant. You are responsible for what you deploy.

---

## What it does, and what it deliberately does not

A thin shell over the `og` binary. Every platform interaction is a child
process: no HTTP, no authentication and no knowledge of OpenGate's API live in
this extension. That is the design. Reimplement one call in TypeScript and there
are two sources of truth, and the TypeScript one is the one that goes stale.

**Completion and diagnostics for the JavaScript itself are not this extension's
job, and you already have them.** `og typegen` writes `og-globals.d.ts` and
`jsconfig.json` into the artifact directory — the platform's ~450 functions,
your organization's real datastream identifiers, the rule's own parameters — and
VS Code's built-in TypeScript service picks them up with or without this
extension:

```js
entity['sensro.temperature']   // Property does not exist on type 'OGEntity'.
                               // Did you mean 'sensor.temperature'?
```

What this adds is everything around that.

## Requirements

- VS Code 1.85+
- The [`og`](https://github.com/carlosprados/og-cli) binary, logged in
  (`og login`).

You do not have to install og yourself. The extension looks for it in this
order: the `og.path` setting, then `og` on your `PATH`, then a copy it keeps for
itself. If it finds none it offers to download the right build for your machine,
**verifies its SHA-256 against the release's `checksums.txt`**, and caches it —
this puts an executable on your machine and then runs it against your platform,
so taking whatever arrives on trust would be the wrong trade.

**2.2.0 or newer** is required: older builds lack `og <family> show --path`,
which the diff depends on. An older one on your PATH is detected and reported,
with the offer to fetch a newer one, rather than failing later with an empty
diff and no explanation.

## The Platform view

A globe in the activity bar lists what is on the platform: Rules,
Connector functions, Provision functions and Workspaces, each expanded on
demand. Clicking an artifact opens it if it is already in your workspace, and
offers to pull it if it is not — matched by identifier, because names are not
unique and directory slugs are derived.

A family that cannot be listed shows the reason under its own node rather than
as a notification: workspaces need a Web API token, and that failing should not
hide the other three.

## Right-click

Everything is on a mouse. Right-clicking a file — in the Explorer, in the
editor, or on its tab — gains an **OpenGate** submenu with diff, what-would-
change, validate, deploy and regenerate-typings, acting on the file you clicked
rather than on whatever happened to be focused.

The submenu appears only on files that could belong to an artifact, and only in
a workspace that has some: the extension activates on one, and the menu is gated
on that, so it stays out of unrelated projects.

## Commands

Every command acts on the artifact the active file belongs to, found by walking
up for `rule.json`, `connectorfunction.json`, `provisionfunction.json`,
`widget.json`, `dashboard.json` or `workspace.json`. The nearest one wins, so
editing a widget acts on that widget and not on the workspace above it.

| Command | What it does |
|---|---|
| **og: Diff this file against the platform** | Opens VS Code's own diff between your file and its remote content. The remote side is a read-only `og-remote:` document. |
| **og: What deploying this artifact would change** | The whole artifact — metadata and every code file — as rendered by `og diff`. For a workspace that is a tree of dashboards and widgets. |
| **og: Validate this artifact** | `og validate` findings as native diagnostics. Local, no credentials. |
| **og: Deploy this artifact** | Shows what would change, asks, then deploys. |
| **og: Regenerate editor typings** | The typings are datamodel-derived and go stale when the organization gains a datastream. |

## Settings

| Setting | Default | |
|---|---|---|
| `og.path` | `og` | Path to the binary |
| `og.org` | *unset* | Only if it should differ from og's own default |
| `og.profile` | *unset* | og profile |
| `og.validateOnSave` | `true` | Local and free; catches artifact-level mistakes |
| `og.deployOnSave` | `false` | Writes to a live platform |
| `og.timeout` | `30000` | Milliseconds before a call is abandoned |

### On `og.deployOnSave`

Off by default, and worth leaving off. An editor that pushes on every save
eventually pushes something you were still thinking about. If you want
deploy-on-save, `og watch` does it from a terminal with a conflict guard and a
production-profile guard, and it is a better place for it.

Do not run both at once over the same tree: two watchers produce duplicate
deploys.

## Credentials

None are stored here. Host, token, organization and profile all come from og's
own configuration (`~/.og/config.yaml`), so there is exactly one place they can
be wrong.

## Related

- [`og-cli`](https://github.com/carlosprados/og-cli) — the binary this drives
- [`og.nvim`](https://github.com/carlosprados/og.nvim) — the same idea for Neovim

## Licence

Apache-2.0.
