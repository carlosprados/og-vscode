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
import * as binary from "./binary";
import * as cli from "./cli";
import { Diagnostics } from "./diagnostics";
import { RemoteContentProvider, SCHEME, openDiff } from "./remote";
import { PlatformTree, openOrPull } from "./tree";

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
    vscode.commands.registerCommand("og.refreshTree", () => tree.refresh()),
    vscode.commands.registerCommand("og.openOrPull", (node) => openOrPull(node)),
    vscode.commands.registerCommand("og.diff", (uri?: vscode.Uri) => openDiff(uri)),
    vscode.commands.registerCommand("og.status", (uri?: vscode.Uri) => status(uri)),
    vscode.commands.registerCommand("og.validate", (uri?: vscode.Uri) => withFile(uri, (f) => diagnostics.run(f))),
    vscode.commands.registerCommand("og.deploy", (uri?: vscode.Uri) => deploy(uri)),
    vscode.commands.registerCommand("og.typegen", (uri?: vscode.Uri) => typegen(uri)),
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
    const res = await cli.run([art.family.command, "diff", art.dir]);
    if (res.code === cli.EXIT_FAILURE) {
      cli.reportFailure(res, "diff failed");
      return;
    }
    // og's text, not a re-render: it carries the three-way state markers, the
    // pruned workspace tree and the note about which fields were ignored.
    await showText(`og diff — ${path.basename(art.dir)}`, res.stdout.trim() || "No differences.");
  });
}

function deploy(uri?: vscode.Uri): void {
  withFile(uri, (filePath) => runDeploy(filePath, true));
}

/** runDeploy pushes the artifact, showing what would change first when asked. */
async function runDeploy(filePath: string, confirm: boolean): Promise<void> {
  const art = artifact.find(filePath);
  if (!art) {
    return;
  }
  const name = path.basename(art.dir);

  if (confirm) {
    // Deploying blind is the habit og's diff was written to break; a quicker
    // keybinding is no reason to reintroduce it.
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
