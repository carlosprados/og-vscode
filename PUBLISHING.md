# Publishing og-vscode

Two marketplaces, because publishing to only the Microsoft one excludes Cursor,
Windsurf, VSCodium and every other VS Code fork — which is a large share of the
people who would install a tool like this.

Everything below is done once, except §4 and §5 which you repeat per release.

---

## 0. Before the first publish — decide the identity

`package.json` currently says `"publisher": "carlosprados"`. That name is claimed
in step 1 and **cannot be changed later without republishing under a new
extension id**, so decide now whether releases come from you personally or from
something like `amplia-community`. Given the governance decision — community
project, not an Amplía product — a personal publisher is the honest label.

The extension id is `<publisher>.<name>`, so today that is
`carlosprados.og-vscode`.

---

## 1. Visual Studio Marketplace — one-time setup

**Do not create an Azure DevOps organization.** The commonly cited route — an
Azure DevOps org, a Personal Access Token, `vsce login` — is both avoidable and
on its way out:

- Creating an org now asks you to link an Azure subscription for billing, and
  the *Continue* button simply sits there disabled if you have none. The page
  does not say that is why. Publishing is free; that gate belongs to a step you
  do not need to take.
- **Global PATs in Azure DevOps are retired on 1 December 2026.** Anything built
  on them has a deadline. Microsoft's replacement is Microsoft Entra ID with
  workload identity federation.

The web portal needs neither.

**1.1 Create the publisher** at
<https://marketplace.visualstudio.com/manage/createpublisher>, signed in with a
Microsoft account. Only **Name** and **ID** are required, and the ID must match
`"publisher"` in `package.json` exactly — today, `carlosprados`.

Leave **Verified domain** empty. Verification is not typing a URL: it wants a TXT
record in the domain's DNS, and the *Verify* button stays greyed out until that
resolves. It can be added later from the publisher settings, and blocking a
first publish on DNS propagation is not a trade worth making.

Everything under *About you* is the publisher profile, not the extension
listing, and is editable afterwards.

**1.2 Upload the package.** From the publisher page: **+ New extension** →
**Visual Studio Code** → select the `.vsix` built in §4.

The first upload runs a virus scan, so it sits at *Verifying* for a few minutes.
It is live once this returns the extension:

```bash
curl -s -X POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery \
  -H "Accept: application/json;api-version=7.2-preview.1" \
  -H "Content-Type: application/json" \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"carlosprados.og-vscode"}]}],"flags":914}'
```

**When a token becomes worth it.** `vsce publish` from the command line still
needs one, and so does CI. Until the Entra ID flow is set up, uploading the
`.vsix` by hand is one drag per release and needs no credentials at all.

---

## 2. Open VSX — one-time setup

Open VSX is the Eclipse Foundation's registry, and it is what the forks use.

**2.1 Sign in** at <https://open-vsx.org> with GitHub.

**2.2 Sign the Publisher Agreement.** *Profile* → *Publisher Agreement*. Open VSX
will refuse to publish without it, and the error does not say so clearly.

**2.3 Create an access token.** *Profile* → *Access Tokens* → *Generate New
Token*. Copy it; also shown once.

**2.4 Claim the namespace.** This is the step with no equivalent on the
Microsoft side and the one that is easy to miss:

```bash
npx ovsx create-namespace carlosprados -p <OPEN_VSX_TOKEN>
```

Without it the first publish fails with a namespace error.

---

## 3. Store the tokens

Only Open VSX needs one for the manual path. Do not put it in the repository;
keep it in your password manager and paste when asked. For CI, GitHub repository
secrets:

- `OVSX_PAT` — the Open VSX token from §2.3
- `VSCE_PAT` — only if you set up command-line publishing to the Marketplace,
  and note its December 2026 deadline (§1)

---

## 4. Per release — prepare

**4.1 Bump the version** in `package.json`. The Marketplace refuses to
republish a version that already exists, exactly like npm.

**4.2 Update `CHANGELOG.md`.** The Marketplace renders it as a tab on the
listing page, so it is read by people deciding whether to install.

**4.3 Check what will ship.**

```bash
npm install
npx vsce ls          # the file list — src/ and node_modules must NOT be there
npx vsce package     # produces og-vscode-<version>.vsix
```

**4.4 Install the .vsix and use it**, rather than trusting that it built:

```bash
code --install-extension og-vscode-<version>.vsix
```

Then open a pulled artifact and run the commands. Packaging succeeding proves
the archive is well-formed, not that the extension works — the last two real
bugs here were found by running it, not by compiling it.

---

## 5. Per release — publish

Marketplace: **+ New extension** → **Visual Studio Code** → the `.vsix` from §4,
on the publisher page. No credentials involved.

Open VSX, which does use a token:

```bash
npx ovsx publish -p <OPEN_VSX_TOKEN>
```

`vsce publish` also works once a token exists, but see §1 before reaching for
one.

`vsce publish` can bump for you — `npx vsce publish minor` — which also creates a
git tag. Skip that if you prefer to tag by hand, as og-cli does.

Both registries take a few minutes to index. The Marketplace also runs a virus
scan on first publish, so the first one takes longer than the rest.

---

## 6. Automating it later

When publishing by hand becomes tedious, a workflow triggered on a `v*` tag —
the same trigger og-cli uses — replaces §5:

```yaml
name: Release
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - run: npx vsce publish -p ${{ secrets.VSCE_PAT }}
      - run: npx ovsx publish -p ${{ secrets.OVSX_PAT }}
```

Worth doing only once the manual path has worked at least once: debugging a
first publish through CI logs is needlessly hard.

---

## 7. What the listing must say

The extension drives a CLI that can write to a production OpenGate tenant, and
it is not an Amplía product. That has to be visible **before** someone installs
it, not only after:

- The README's first block is the disclaimer, and the Marketplace renders the
  README as the listing page — so this is already handled, provided the
  disclaimer stays at the top.
- Keep `"description"` in `package.json` saying it too. It is what appears in
  search results, where the README does not.

---

## 8. Known snags

| Symptom | Cause |
|---|---|
| *Continue* greyed out creating an Azure DevOps organization | It wants an Azure subscription linked for billing and says so in small print. You do not need the organization at all — see §1 |
| `401 Unauthorized` on `vsce login` | The PAT is scoped to one organization instead of *All accessible organizations*. Only relevant if you went the token route |
| `Verify` greyed out on the publisher's domain | Verification needs a DNS TXT record, not just the URL typed in. Leave it empty; add it later |
| `ERROR namespace not found` | The Open VSX namespace was never claimed (§2.4) |
| `ERROR The Publisher Agreement...` | Not signed (§2.2) |
| Publish succeeds, extension does not appear | Indexing delay, or a first-publish virus scan. Check the publisher management page |
| `Missing publisher name` | `"publisher"` absent from `package.json` |
| Icon rejected | Must be a PNG, at least 128×128. `resources/icon.png` is 128×128 |
