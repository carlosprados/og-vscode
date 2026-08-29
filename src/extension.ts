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
import * as cli from "./cli";
import { Diagnostics } from "./diagnostics";
import { RemoteContentProvider, SCHEME, openDiff } from "./remote";

let diagnostics: Diagnostics;

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = new Diagnostics();
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, new RemoteContentProvider()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("og.diff", () => openDiff()),
    vscode.commands.registerCommand("og.status", () => status()),
    vscode.commands.registerCommand("og.validate", () => withActiveFile((f) => diagnostics.run(f))),
    vscode.commands.registerCommand("og.deploy", () => deploy()),
    vscode.commands.registerCommand("og.typegen", () => typegen()),
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

function withActiveFile(fn: (filePath: string) => Promise<void> | void): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    void vscode.window.showWarningMessage("og: no file is open");
    return;
  }
  void fn(editor.document.uri.fsPath);
}

/** status shows og's own rendering of what deploying would change. */
function status(): void {
  withActiveFile(async (filePath) => {
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

function deploy(): void {
  withActiveFile((filePath) => runDeploy(filePath, true));
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
function typegen(): void {
  withActiveFile(async (filePath) => {
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
