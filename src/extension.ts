// og-vscode — OpenGate artifact editing in VS Code.
//
// A thin shell over the `og` binary. Every platform interaction is a child
// process; there is no HTTP, no auth and no path knowledge here, and that is
// the design rather than an omission.
//
// Completion and diagnostics for the JavaScript itself are NOT this extension's
// job: `og typegen` writes og-globals.d.ts and jsconfig.json into the artifact
// directory, and the built-in TypeScript language service picks them up. That
// works with or without this extension installed.

import * as path from "node:path";
import * as vscode from "vscode";
import * as artifact from "./artifact";
import * as auth from "./auth";
import * as binary from "./binary";
import * as cli from "./cli";
import { Diagnostics } from "./diagnostics";
import { RemoteContentProvider, SCHEME, openDiff } from "./remote";
import { ArtifactNode, PlatformTree, openOrPull } from "./tree";

let diagnostics: Diagnostics;

export function activate(context: vscode.ExtensionContext): void {
  cli.init(context);

  // Gates the right-click menus. The extension activates on a workspace that
  // contains artifacts, so without this key the menu entries would advertise
  // themselves on every .js file in every unrelated project.
  void vscode.commands.executeCommand("setContext", "og.enabled", true);

  diagnostics = new Diagnostics();
  context.subscriptions.push(diagnostics);

  // Changing where the binary is means the cached resolution is stale, and a
  // user who has just fixed og.path should not have to reload the window to
  // find out whether it worked.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("og.path")) {
        binary.forget();
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, new RemoteContentProvider()),
  );

  const tree = new PlatformTree();
  context.subscriptions.push(vscode.window.registerTreeDataProvider("og.platform", tree));

  context.subscriptions.push(
    vscode.commands.registerCommand("og.login", async () => {
      if (await auth.login(context)) {
        tree.refresh();
      }
    }),
    vscode.commands.registerCommand("og.refreshTree", () => tree.refresh()),
    vscode.commands.registerCommand("og.openOrPull", (node) => openOrPull(node)),
    vscode.commands.registerCommand("og.diff", async (arg?: unknown) => {
      if (await auth.ensure(context)) {
        await openDiff(toUri(arg));
      }
    }),
    vscode.commands.registerCommand("og.status", async (arg?: unknown) => {
      if (await auth.ensure(context)) {
        status(toUri(arg));
      }
    }),
    vscode.commands.registerCommand("og.validate", (arg?: unknown) =>
      withFile(toUri(arg), (f) => diagnostics.run(f)),
    ),
    vscode.commands.registerCommand("og.deploy", async (arg?: unknown) => {
      if (await auth.ensure(context)) {
        deploy(toUri(arg));
      }
    }),
    vscode.commands.registerCommand("og.typegen", async (arg?: unknown) => {
      if (await auth.ensure(context)) {
        typegen(toUri(arg));
      }
    }),
    vscode.commands.registerCommand("og.pull", (node: ArtifactNode) => openOrPull(node).then(() => tree.refresh())),
  );

  // Saving is the only hook. Deliberately not `og watch`: two watchers over the
  // same files produce duplicate deploys, and og watch serves terminal and
  // Neovim users.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (doc.uri.scheme !== "file" || !artifact.find(doc.uri.fsPath)) {
        return;
      }
      const config = vscode.workspace.getConfiguration("og");
      if (config.get<boolean>("validateOnSave", true)) {
        await diagnostics.run(doc.uri.fsPath, true);
      }
      if (config.get<boolean>("deployOnSave", false)) {
        // No confirmation here: switching this on IS the consent, and prompting
        // on every write would make it unusable.
        await runDeploy(doc.uri.fsPath, false);
      }
    }),
  );
}

export function deactivate(): void {
  diagnostics?.dispose();
}

/**
 * toUri normalises what a command was invoked with.
 *
 * Four callers, three shapes: the palette passes nothing, the Explorer and
 * editor menus pass a Uri, and the Platform view passes its own node. Resolving
 * it here is what lets one command serve all of them instead of each surface
 * getting its own.
 */
function toUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  const node = arg as ArtifactNode | undefined;
  if (node && node.type === "artifact" && node.local) {
    return vscode.Uri.file(node.local);
  }
  return undefined;
}

/**
 * withFile resolves which file a command acts on.
 *
 * Commands are reached three ways: from the palette, where it is the active
 * editor; from the Explorer context menu, where VS Code passes the clicked
 * resource; and from the editor context menu, where it passes the document.
 * Taking the argument when there is one is what makes the right-click menus act
 * on what was right-clicked rather than on whatever happened to be focused.
 */
function withFile(target: vscode.Uri | undefined, fn: (filePath: string) => Promise<void> | void): void {
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== "file") {
    void vscode.window.showWarningMessage("og: no file is open");
    return;
  }
  void fn(uri.fsPath);
}

/** status shows og's own rendering of what deploying would change. */
function status(uri?: vscode.Uri): void {
  withFile(uri, async (filePath) => {
    const art = artifact.find(filePath);
    if (!art) {
      void vscode.window.showWarningMessage("og: this file is not inside an artifact directory");
      return;
    }
    // A widget has no diff of its own — it is a grid item, and the dashboard is
    // the smallest thing og can compare or deploy — so the comparison happens
    // one level up, and says so rather than looking like it ignored the request.
    const target = artifact.anchor(art);
    if (!target) {
      void vscode.window.showWarningMessage(
        `og: a ${art.family.kind} is compared through its dashboard, and this one is not inside a pulled dashboard directory`,
      );
      return;
    }
    if (target.dir !== art.dir) {
      void vscode.window.showInformationMessage(
        `og: comparing the ${target.family.kind} ${path.basename(target.dir)} — og has no diff for a single ${art.family.kind}.`,
      );
    }

    const res = await cli.run([target.family.command, "diff", target.dir]);
    if (res.code === cli.EXIT_FAILURE) {
      cli.reportFailure(res, "diff failed");
      return;
    }
    // og's text, not a re-render: it carries the three-way state markers, the
    // pruned workspace tree and the note about which fields were ignored.
    await showText(`og diff — ${path.basename(target.dir)}`, res.stdout.trim() || "No differences.");
  });
}

function deploy(uri?: vscode.Uri): void {
  withFile(uri, (filePath) => runDeploy(filePath, true));
}

/** runDeploy pushes the artifact, showing what would change first when asked. */
async function runDeploy(filePath: string, confirm: boolean): Promise<void> {
  const found = artifact.find(filePath);
  if (!found) {
    return;
  }

  // A widget cannot be deployed on its own: the platform has no endpoint for a
  // grid item, so the dashboard is what goes. This is the rule `og workspace
  // watch` already follows for a widget edit, and the confirmation below shows
  // the dashboard's diff, so what is sent is what was agreed to.
  const art = artifact.anchor(found);
  if (!art) {
    void vscode.window.showWarningMessage(
      `og: a ${found.family.kind} deploys as its dashboard, and this one is not inside a pulled dashboard directory`,
    );
    return;
  }
  const name = path.basename(art.dir);
  if (art.dir !== found.dir) {
    void vscode.window.showInformationMessage(
      `og: a ${found.family.kind} deploys as its ${art.family.kind} — ${name} is what will be sent.`,
    );
  }

  if (confirm) {
    // Deploying blind is the habit og's diff was written to break; a quicker
    // keybinding is no reason to reintroduce it.
    //
    const preview = await cli.run([art.family.command, "diff", art.dir]);
    if (preview.code === cli.EXIT_FAILURE) {
      cli.reportFailure(preview, "cannot read the remote artifact; not deploying");
      return;
    }
    if (preview.code === cli.EXIT_OK && !preview.stdout.trim()) {
      void vscode.window.showInformationMessage(`og: ${name} matches the platform — nothing to deploy.`);
      return;
    }
    await showText(`og deploy? — ${name}`, preview.stdout.trim());
    const choice = await vscode.window.showWarningMessage(
      `Deploy ${name} to the platform?`,
      { modal: true },
      "Deploy",
    );
    if (choice !== "Deploy") {
      return;
    }
  }

  const res = await cli.run([art.family.command, "deploy", art.dir, "--update"]);
  if (res.code !== cli.EXIT_OK) {
    cli.reportFailure(res, `deploying ${name} failed`);
    return;
  }
  void vscode.window.showInformationMessage(`og: ${res.stdout.trim() || `${name} deployed.`}`);
}

/** typegen regenerates the datamodel-derived typings for this artifact. */
function typegen(uri?: vscode.Uri): void {
  withFile(uri, async (filePath) => {
    const art = artifact.find(filePath);
    if (!art) {
      void vscode.window.showWarningMessage("og: this file is not inside an artifact directory");
      return;
    }
    const res = await cli.run(["typegen", "--out", art.dir]);
    if (res.code !== cli.EXIT_OK) {
      cli.reportFailure(res, "typegen failed");
      return;
    }
    void vscode.window.showInformationMessage(`og: ${res.stdout.trim()}`);
  });
}

async function showText(title: string, body: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content: `${title}\n\n${body}\n`, language: "diff" });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}
