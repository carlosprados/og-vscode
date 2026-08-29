// Running the og binary.
//
// The only module that reaches the platform, and it does so by asking the
// binary. There is no HTTP here and there must never be: reimplement one call
// in TypeScript and there are two sources of truth for auth, paths and quirks,
// and the TypeScript one is the one that goes stale.
//
// Ported from og.nvim, which settled these decisions against a live tenant.

import { execFile } from "node:child_process";
import * as vscode from "vscode";
import * as binary from "./binary";

let extensionContext: vscode.ExtensionContext | undefined;

/** init hands the module the context the binary cache lives in. */
export function init(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

/** og's exit codes, shared by diff and validate so CI can gate on them. */
export const EXIT_OK = 0;
export const EXIT_DIFF = 1;
export const EXIT_FAILURE = 2;

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function config() {
  return vscode.workspace.getConfiguration("og");
}

/** Global flags every invocation carries, from the settings. */
function globalArgs(): string[] {
  const args: string[] = [];
  const org = config().get<string | null>("org");
  const profile = config().get<string | null>("profile");
  if (org) {
    args.push("--org", org);
  }
  if (profile) {
    args.push("--profile", profile);
  }
  return args;
}

/**
 * run invokes og and resolves with the raw result.
 *
 * A non-zero exit is not thrown: exit code 1 means "differences found", which
 * is og working correctly, and turning that into an exception would make every
 * caller unwrap it again.
 */
export async function run(args: string[], cwd?: string): Promise<Result> {
  if (!extensionContext) {
    return { code: EXIT_FAILURE, stdout: "", stderr: "the extension is not initialised" };
  }
  const bin = await binary.resolve(extensionContext);
  if (!bin) {
    // resolve has already told the user what is wrong and offered a fix; a
    // second message here would just be noise.
    return { code: EXIT_FAILURE, stdout: "", stderr: "" };
  }

  const timeout = config().get<number>("timeout", 30000);
  const full = [...globalArgs(), ...args];

  return new Promise((resolve) => {
    execFile(
      bin,
      full,
      { cwd, timeout, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof (error as { code?: unknown }).code === "string") {
          // Spawn failure — ENOENT and friends — rather than a non-zero exit.
          resolve({ code: EXIT_FAILURE, stdout: "", stderr: error.message });
          return;
        }
        const code = error ? (error as { code?: number }).code ?? EXIT_FAILURE : EXIT_OK;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

/**
 * runJson invokes og with -o json and unwraps the versioned envelope.
 *
 * og wraps every JSON payload as {schemaVersion, kind, data}. Callers want the
 * data; the envelope is checked here so a future schema bump surfaces in one
 * place rather than as an undefined field deep in a caller.
 */
export async function runJson<T>(args: string[], cwd?: string): Promise<{ data: T | null; res: Result }> {
  const res = await run([...args, "-o", "json"], cwd);
  if (!res.stdout.trim()) {
    return { data: null, res };
  }
  try {
    const parsed = JSON.parse(res.stdout);
    return { data: (parsed?.data ?? parsed) as T, res };
  } catch {
    return { data: null, res };
  }
}

/**
 * reportFailure surfaces a failed invocation, preferring og's own message.
 *
 * og's errors are written for a human and usually say what to do next, so
 * passing them through beats wrapping them in an extension-flavoured sentence.
 */
export function reportFailure(res: Result, context: string): void {
  const message = res.stderr.trim() || res.stdout.trim();
  if (!message) {
    // Nothing to add: the binary could not be resolved, and that was already
    // reported with the choices that go with it.
    return;
  }
  void vscode.window.showErrorMessage(`og: ${context}\n${message}`);
}
