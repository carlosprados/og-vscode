// The `og-remote:` scheme, and the diff built on it.
//
// VS Code renders diffs itself: register a content provider for a scheme, hand
// two URIs to vscode.diff, and the result behaves like every other diff in the
// editor. Nothing about diffing is implemented here, deliberately — the same
// decision og.nvim took, for the same reason.

import * as path from "node:path";
import * as vscode from "vscode";
import * as artifact from "./artifact";
import * as cli from "./cli";

export const SCHEME = "og-remote";

/**
 * A URI carries what the provider needs to fetch the file again:
 *
 *   og-remote:/<relative-path>?command=<family>&id=<artifact-id>&dir=<artifact-dir>
 *
 * The path ends in the real filename so VS Code picks the right language, and
 * the diff title reads like a filename rather than an opaque handle.
 */
function uriFor(art: artifact.Artifact, rel: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: SCHEME,
    path: "/" + rel,
    query: new URLSearchParams({
      command: art.family.command,
      id: art.id ?? "",
      dir: art.dir,
    }).toString(),
  });
}

export class RemoteContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const command = params.get("command");
    const id = params.get("id");
    const rel = uri.path.replace(/^\//, "");
    if (!command || !id) {
      return "";
    }

    const res = await cli.run([command, "show", id, "--path", rel], params.get("dir") ?? undefined);
    if (res.code !== cli.EXIT_OK) {
      cli.reportFailure(res, `cannot read the remote ${rel}`);
      return "";
    }
    return res.stdout;
  }
}

/**
 * openDiff shows a file against its remote content.
 *
 * The uri is optional because the same command is reached three ways: the
 * palette, where it means the active editor, and the two context menus, where
 * VS Code passes the resource that was clicked.
 */
export async function openDiff(target?: vscode.Uri): Promise<void> {
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== "file") {
    return;
  }
  const filePath = uri.fsPath;

  const art = artifact.find(filePath);
  if (!art) {
    void vscode.window.showWarningMessage(
      "og: this file is not inside an artifact directory. Pull one with `og rules pull`, `og workspace pull`, …",
    );
    return;
  }
  if (!art.family.remoteFile) {
    void vscode.window.showInformationMessage(
      `og: og has no single-file view of a ${art.family.kind} — "What deploying this artifact would change" compares the whole tree`,
    );
    return;
  }

  // A widget is read through its dashboard: `og dashboard show --path` takes the
  // widget directory and the file, which is exactly the path the pull wrote.
  const anchor = artifact.anchor(art);
  if (!anchor) {
    void vscode.window.showWarningMessage(
      `og: a ${art.family.kind} is addressed through its dashboard, and this one is not inside a pulled dashboard directory`,
    );
    return;
  }
  if (!anchor.id) {
    void vscode.window.showWarningMessage(
      `og: this ${anchor.family.kind} has no identifier in ${anchor.family.meta} — nothing remote to compare against`,
    );
    return;
  }

  let rel = artifact.codeFile(anchor, filePath);
  if (!rel) {
    void vscode.window.showWarningMessage("og: this file is not inside the artifact directory");
    return;
  }

  // Reached from the Platform view — or by right-clicking rule.json — the
  // target is the artifact rather than one of its files. A diff needs a file,
  // so resolve one: metadata is compared by "What deploying would change",
  // which reports it structurally instead of as text.
  if (!rel.endsWith(".js")) {
    const chosen = await chooseCodeFile(art, anchor);
    if (!chosen) {
      return;
    }
    rel = chosen;
  }
  const localUri = vscode.Uri.file(path.join(anchor.dir, rel));

  await vscode.commands.executeCommand(
    "vscode.diff",
    uriFor(anchor, rel),
    localUri,
    `${path.basename(rel)} — platform ↔ local`,
    { preview: true },
  );
}

/**
 * chooseCodeFile picks which of an artifact's files to diff.
 *
 * The flat families carry exactly one code field, so the question never comes up
 * for them. A widget does: a list widget has one formatter per column, and there
 * is no basis for guessing which of five was meant.
 */
async function chooseCodeFile(art: artifact.Artifact, anchor: artifact.Artifact): Promise<string | undefined> {
  const found = await vscode.workspace.findFiles(new vscode.RelativePattern(art.dir, "*.js"));
  // Named relative to the anchor, since that is what the remote side is asked
  // for: on a widget that is "<widget-dir>/<file>.js".
  const prefix = art.dir === anchor.dir ? "" : path.relative(anchor.dir, art.dir).split(path.sep).join("/") + "/";
  const names = found.map((f) => prefix + path.basename(f.fsPath)).sort();

  if (names.length === 0) {
    void vscode.window.showInformationMessage(
      `og: this ${art.family.kind} has no code file to diff — "What deploying this artifact would change" compares its metadata`,
    );
    return undefined;
  }
  if (names.length === 1) {
    return names[0];
  }
  return vscode.window.showQuickPick(names, { title: "Which file to compare against the platform?" });
}
