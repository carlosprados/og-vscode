// Logging in.
//
// The extension stores no credentials and implements no authentication. It
// collects what `og login` asks for and hands it over; og writes the token into
// its own profile, with its own permissions, in the one place it already lives.
// Anything else would give the platform two places to be logged in and one of
// them would be wrong.
//
// This exists because the extension now fetches the binary for people who have
// never used the CLI. Downloading og for someone and then leaving them at a 401
// telling them to open a terminal is half a feature.

import * as vscode from "vscode";
import * as binary from "./binary";
import * as cli from "./cli";

/**
 * looksUnauthenticated recognises og's own message for having no session.
 *
 * Matched on the status rather than the prose: the wording is the platform's
 * and may be translated or reworded, the 401 will not be.
 */
export function looksUnauthenticated(message: string): boolean {
  return /\b401\b/.test(message) || /unauthorized/i.test(message);
}

/**
 * login collects credentials and runs `og login`.
 *
 * The password goes through the environment, never the argument list: arguments
 * are visible to anyone who can run `ps` on the machine, which on a shared or
 * managed workstation is not nobody.
 */
export async function login(context: vscode.ExtensionContext): Promise<boolean> {
  const bin = await binary.resolve(context);
  if (!bin) {
    return false;
  }

  const config = vscode.workspace.getConfiguration("og");
  const profile = config.get<string | null>("profile") ?? undefined;

  const host = await vscode.window.showInputBox({
    title: "og: log in (1 of 3)",
    prompt: "OpenGate host",
    value: "https://api.opengate.es",
    ignoreFocusOut: true,
  });
  if (!host) {
    return false;
  }

  const email = await vscode.window.showInputBox({
    title: "og: log in (2 of 3)",
    prompt: "Email",
    placeHolder: "you@example.com",
    ignoreFocusOut: true,
    validateInput: (v) => (v.includes("@") ? undefined : "og authenticates with an email address"),
  });
  if (!email) {
    return false;
  }

  const password = await vscode.window.showInputBox({
    title: "og: log in (3 of 3)",
    prompt: "Password — not stored by this extension; og writes the token to its own profile",
    password: true,
    ignoreFocusOut: true,
  });
  if (!password) {
    return false;
  }

  // Asked only if the account has it. Prompting everyone for a code they do not
  // have is a step most people would have to guess their way past.
  const code = await vscode.window.showInputBox({
    title: "og: two-factor code (optional)",
    prompt: "Leave empty unless this account has 2FA enabled",
    placeHolder: "123456",
    ignoreFocusOut: true,
  });

  // `og login` has no --host: the host comes from the profile, and OG_HOST
  // overrides it. Verified against the binary rather than assumed.
  // OpenGate allows one web session per user, and og signs in to the Web API as
  // well by default. With a browser open on the same account that evicts it.
  // Workspaces and dashboards need that token, so the trade is real and belongs
  // to the person making it rather than to a default they never saw.
  const scope = await vscode.window.showQuickPick(
    [
      {
        label: "Everything",
        description: "workspaces and dashboards included",
        detail: "Signs in to the Web API too. Can evict your browser session on this account.",
        web: true,
      },
      {
        label: "Leave my browser session alone",
        description: "rules, connector functions, provision functions",
        detail: "Skips the Web API sign-in. Workspaces and dashboards will not be available.",
        web: false,
      },
    ],
    { title: "og: how much access?", ignoreFocusOut: true },
  );
  if (!scope) {
    return false;
  }

  const args = ["login", "--email", email];
  if (!scope.web) {
    args.push("--no-web");
  }
  if (code && code.trim() !== "") {
    args.push("--2fa-code", code.trim());
  }
  if (profile) {
    args.push("--profile", profile);
  }

  const res = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "og: logging in" },
    () => cli.run(args, undefined, { OG_PASSWORD: password, OG_HOST: host }),
  );

  if (res.code !== cli.EXIT_OK) {
    cli.reportFailure(res, "login failed");
    return false;
  }
  void vscode.window.showInformationMessage(`og: logged in as ${email}.`);
  return true;
}
