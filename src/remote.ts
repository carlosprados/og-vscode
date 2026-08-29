// The `og-remote:` scheme, and the diff built on it.
//
// VS Code renders diffs itself: register a content provider for a scheme, hand
// two URIs to vscode.diff, and the result behaves like every other diff in the
// editor. Nothing about diffing is implemented here, deliberately — the same
// decision og.nvim took, for the same reason.

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

/** openDiff shows the active file against its remote content. */
export async function openDiff(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const filePath = editor.document.uri.fsPath;

  const art = artifact.find(filePath);
  if (!art) {
    void vscode.window.showWarningMessage(
      "og: this file is not inside an artifact directory. Pull one with `og rules pull`, `og workspace pull`, …",
    );
    return;
  }
  if (!art.id) {
    void vscode.window.showWarningMessage(
      `og: this ${art.family.kind} has no identifier in ${art.family.meta} — nothing remote to compare against`,
    );
    return;
  }

  const rel = artifact.codeFile(art, filePath);
  if (!rel) {
    void vscode.window.showWarningMessage("og: this file is not inside the artifact directory");
    return;
  }
  if (!rel.endsWith(".js")) {
    void vscode.window.showInformationMessage(
      `og: ${rel} is not a code file — "What deploying this artifact would change" covers metadata too`,
    );
    return;
  }

  await vscode.commands.executeCommand(
    "vscode.diff",
    uriFor(art, rel),
    editor.document.uri,
    `${rel} — platform ↔ local`,
    { preview: true },
  );
}
