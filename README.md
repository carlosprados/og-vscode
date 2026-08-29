# OpenGate (og) for VS Code

Write OpenGate's embedded JavaScript — automation rules, connector functions,
provision functions, dashboards and widgets — in your editor instead of the
platform's, against a live tenant.

> ### Unofficial community project
>
> Not an Amplía Soluciones product, not supported by Amplía, no warranty. It
> drives the [`og`](https://github.com/carlosprados/og-cli) CLI, which **writes
> to real OpenGate tenants**. You are responsible for what you deploy.

---

## Quick start

Five minutes, and nothing to install beforehand.

### 1. Install

Search **OpenGate** in the Extensions view, or:

```
code --install-extension carlosprados.og-vscode
```

You do **not** need the `og` CLI already. If it is not on your `PATH`, the
extension offers to download the right build for your machine and verifies its
SHA-256 before using it.

### 2. Open a folder

Any folder — it is where your artifacts get pulled to. One must be open, or
there is nowhere to put them.

### 3. Log in

`Ctrl+Shift+P` → **og: Log in to OpenGate**

| It asks for | |
|---|---|
| **Host** | `https://api.opengate.es` unless yours is elsewhere |
| **Email** | Your OpenGate account |
| **Password** | Not stored by this extension — see [Logging in](#logging-in) |
| **2FA code** | Leave empty unless your account has it |

Then it asks how much access you want. Take **Everything** the first time; the
trade-off is explained in [Logging in](#logging-in).

### 4. Get something to edit

Click the **globe** in the activity bar. It lists what is on your tenant.

Expand **Rules** and click one. It is not on your machine yet, so you are asked
where to put it — accept the suggestion. It downloads and opens.

### 5. See it work

In the file that just opened, type a datastream identifier that does not exist:

```js
entity['this.does.not.exist']
```

It is underlined **before you deploy anything**. Pulling the artifact also wrote
the type declarations for *your* organization: its real datastream identifiers
and the ~450 platform functions.

Now change something real and right-click the file → **OpenGate** → **Diff
against the platform**. You get VS Code's own diff: your version against what
the tenant has right now.

Nothing has been deployed. **Deploy** is a separate action that shows you the
diff and asks first.

---

## What this does, and what it does not

A thin shell over the `og` binary. Every platform interaction is a child
process: no HTTP, no authentication and no knowledge of OpenGate's API live in
this extension, by design. Reimplement one call here and there are two sources
of truth, and this would be the one that goes stale.

**The autocompletion does not come from this extension**, and works with or
without it. `og typegen` writes `og-globals.d.ts` and `jsconfig.json` into each
artifact directory and VS Code's built-in TypeScript service reads them — which
is why step 5 works. What this adds is everything around it: browsing, diffing,
validating, deploying and logging in without leaving the editor.

---

## The Platform view

The globe in the activity bar lists your tenant: **Rules**, **Connector
functions**, **Provision functions** and **Workspaces**, expanded on demand.

- A **cloud** means it is not on your machine. Click to pull it.
- A **file** icon and `· here` means you have it. Click to open.

Matching is by identifier, not folder name: names are not unique and slugs are
derived.

A family that cannot be listed shows the reason under its own node rather than
as a popup — workspaces need the Web API token, and that failing should not hide
the other three.

---

## Right-click

Everything is reachable with a mouse. Right-clicking gains an **OpenGate**
submenu: in the Explorer, in the editor, on the editor tab, and on a node in the
Platform view.

In the tree the menu depends on what you have. An artifact that is not here
offers only **Pull** — everything else needs a local directory to act on.

---

## Commands

| Command | What it does |
|---|---|
| **Log in to OpenGate** | Credentials → `og login`. Nothing stored here. |
| **Diff this file against the platform** | VS Code's own diff against the remote content. Invoked on an artifact rather than a file, it resolves the code file, asking which when there is more than one. |
| **What deploying this artifact would change** | The whole artifact — metadata and every code file — as `og diff` renders it. For a workspace, a tree of dashboards and widgets. |
| **Validate this artifact** | Findings in the Problems panel. Local, no credentials, milliseconds. Also runs on save. |
| **Deploy this artifact** | Shows what would change, asks, then deploys. |
| **Regenerate editor typings** | They come from your datamodel and go stale when the organization gains a datastream. |

Every command acts on the artifact the file belongs to, found by walking up for
`rule.json`, `connectorfunction.json`, `provisionfunction.json`, `widget.json`,
`dashboard.json` or `workspace.json`. The nearest one wins, so editing a widget
acts on that widget and not on the workspace above it.

---

## Logging in

`og login` does the authenticating; this extension only collects what it asks
for. The token goes into og's own profile (`~/.og/config.yaml`, created at mode
0600 if absent) and **no password is stored anywhere**. The password reaches og
through the environment rather than the command line, because arguments are
readable by anything that can list processes.

**Why it asks how much access you want.** OpenGate allows one web session per
user. The Web API sign-in that workspaces and dashboards need can therefore
evict your browser session on the same account, repeatedly. Declining it covers
rules, connector functions and provision functions and leaves your browser
alone. A dedicated account for the CLI avoids the question entirely.

Any command that fails with a 401 offers to log in.

---

## Settings

| Setting | Default | |
|---|---|---|
| `og.path` | `og` | Path to the binary. Leave it unless you keep og somewhere unusual |
| `og.org` | *unset* | Only if it should differ from og's own default |
| `og.profile` | *unset* | og profile, for working against more than one tenant |
| `og.validateOnSave` | `true` | Local and free |
| `og.deployOnSave` | `false` | Writes to a live platform |
| `og.timeout` | `30000` | Milliseconds before a call is abandoned |

### On `og.deployOnSave`

Off by default, and worth leaving off. An editor that pushes on every save
eventually pushes something you were still thinking about.

If you want deploy-on-save, `og watch` does it from a terminal with a conflict
guard and a production-profile guard, and is a better place for it. Do not run
both over the same tree: two watchers produce duplicate deploys.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| `HTTP 401: Unauthorized` | No session. Take the **Log in** button on the error |
| *the CLI was not found* | No `og` on `PATH`. Take **Download it**, or set `og.path` |
| *older than 2.2.0* | Your og predates `show --path`, which the diff needs. Take the offer to fetch a newer one |
| The **OpenGate** submenu is missing | The extension activates on a folder that contains artifacts. Open one, or pull something from the Platform view first |
| Workspaces will not list | They need the Web API token. Log in again choosing **Everything** |
| No completion in a `.js` | That artifact has no `og-globals.d.ts`. Run **Regenerate editor typings** |
| A diff opens empty | Usually an og too old for `show --path` |

---

## Related

- [`og-cli`](https://github.com/carlosprados/og-cli) — the binary this drives, and the full command reference
- [`og.nvim`](https://github.com/carlosprados/og.nvim) — the same idea for Neovim

## Licence

Apache-2.0.
