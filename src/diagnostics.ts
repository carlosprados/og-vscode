// `og <family> validate` as native diagnostics.
//
// Local, credential-free and measured in milliseconds, which is why it can run
// on every save. It is not a JavaScript checker — that is tsserver's job,
// driven by the jsconfig `og typegen` writes — it catches the artifact-level
// mistakes a type checker cannot see: a declared code file that is missing,
// metadata that is not valid JSON, a connector function that would deploy and
// never fire.

import * as path from "node:path";
import * as vscode from "vscode";
import * as artifact from "./artifact";
import * as cli from "./cli";

interface Finding {
  severity: string;
  file?: string;
  line?: number;
  message: string;
}

interface ValidateResult {
  dir: string;
  kind: string;
  findings?: Finding[];
}

const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  warn: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export class Diagnostics {
  private readonly collection = vscode.languages.createDiagnosticCollection("og");

  dispose(): void {
    this.collection.dispose();
  }

  /**
   * run validates the artifact a file belongs to and publishes the result.
   *
   * @param silent suppresses the "nothing to report" and "no validator"
   *   notifications, for the on-save path where they would be noise.
   */
  async run(filePath: string, silent = false): Promise<void> {
    const art = artifact.find(filePath);
    if (!art) {
      if (!silent) {
        void vscode.window.showWarningMessage("og: this file is not inside an artifact directory");
      }
      return;
    }
    if (!art.family.validatable) {
      if (!silent) {
        void vscode.window.showInformationMessage(
          `og: ${art.family.kind} has no validator — use "What deploying this artifact would change", which covers this family`,
        );
      }
      return;
    }

    const { data, res } = await cli.runJson<ValidateResult>([art.family.command, "validate", art.dir]);
    if (res.code === cli.EXIT_FAILURE || !data) {
      if (!silent) {
        cli.reportFailure(res, "validate failed");
      }
      return;
    }

    this.clearUnder(art.dir);

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const finding of data.findings ?? []) {
      // og keeps the file in its own field and its message reads as the
      // continuation of it — "is missing, but the rule is in ADVANCED mode".
      // On that file's own document it is right; anywhere else the message has
      // to say what it is about, or it names nothing at all.
      const target = finding.file ? path.join(art.dir, finding.file) : filePath;
      const named = finding.file && target !== filePath;
      const message = named ? `${finding.file} ${finding.message}` : finding.message;

      const line = Math.max((finding.line ?? 1) - 1, 0);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        message,
        SEVERITY[finding.severity] ?? vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = "og";

      const list = byFile.get(target) ?? [];
      list.push(diagnostic);
      byFile.set(target, list);
    }

    for (const [file, items] of byFile) {
      this.collection.set(vscode.Uri.file(file), items);
    }

    if (!silent && byFile.size === 0) {
      void vscode.window.showInformationMessage(`og: ${path.basename(art.dir)} — no problems found.`);
    }
  }

  /**
   * clearUnder drops this artifact's diagnostics before republishing.
   *
   * Scoped to the directory rather than clearing everything: several artifacts
   * are usually open at once, and validating one should not wipe the findings
   * on its neighbours.
   */
  private clearUnder(dir: string): void {
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    const stale: vscode.Uri[] = [];
    this.collection.forEach((uri) => {
      if (uri.fsPath.startsWith(prefix)) {
        stale.push(uri);
      }
    });
    for (const uri of stale) {
      this.collection.delete(uri);
    }
  }
}
