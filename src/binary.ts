// Finding, checking and — when it is not there — fetching the og binary.
//
// The extension is a shell over a program the user may not have. Three ways to
// get one, in order of how much they are the user's own choice:
//
//   1. `og.path`, when it is set to something other than the default.
//   2. `og` on PATH — what someone who already uses the CLI expects.
//   3. A copy downloaded into globalStorage, checksum-verified, used by this
//      extension and nothing else.
//
// The version is checked as well as the presence, because the failure otherwise
// is baffling: an og older than 2.2.0 has no `show --path`, so the diff opens
// empty and nothing says why.

import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/** The oldest og that has `show --path`, which the diff view depends on. */
export const MINIMUM_VERSION = "2.2.0";

const REPO = "carlosprados/og-cli";

let resolved: string | undefined;
let warnedAboutVersion = false;

/** forget drops the cached resolution, for when the setting changes. */
export function forget(): void {
  resolved = undefined;
  warnedAboutVersion = false;
}

/**
 * resolve returns a usable og, or undefined when there is none and the user
 * declined to fetch one.
 */
export async function resolve(context: vscode.ExtensionContext): Promise<string | undefined> {
  if (resolved) {
    return resolved;
  }

  const configured = vscode.workspace.getConfiguration("og").get<string>("path", "og");
  const candidates = configured !== "og" ? [configured] : ["og", cachedPath(context)];

  for (const candidate of candidates) {
    const version = await versionOf(candidate);
    if (!version) {
      continue;
    }
    resolved = candidate;
    if (isOlderThanMinimum(version) && !warnedAboutVersion) {
      warnedAboutVersion = true;
      void vscode.window
        .showWarningMessage(
          `og ${version} is older than ${MINIMUM_VERSION}, which added \`show --path\`. The diff view will not work.`,
          "Download a newer one",
        )
        .then(async (choice) => {
          if (choice === "Download a newer one") {
            const fresh = await download(context);
            if (fresh) {
              resolved = fresh;
            }
          }
        });
    }
    return resolved;
  }

  const choice = await vscode.window.showErrorMessage(
    "og: the CLI was not found. The extension drives it; it cannot do anything without one.",
    "Download it",
    "Set og.path",
  );
  if (choice === "Set og.path") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "og.path");
    return undefined;
  }
  if (choice !== "Download it") {
    return undefined;
  }
  resolved = await download(context);
  return resolved;
}

/** versionOf runs `<bin> version` and returns the version, or undefined. */
function versionOf(bin: string): Promise<string | undefined> {
  return new Promise((done) => {
    execFile(bin, ["version"], { timeout: 10000 }, (error, stdout) => {
      if (error) {
        done(undefined);
        return;
      }
      // `og 2.2.1 (commit: …, built: …)`
      const match = /(\d+)\.(\d+)\.(\d+)/.exec(stdout ?? "");
      done(match ? match[0] : undefined);
    });
  });
}

function isOlderThanMinimum(version: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10));
  const [a, b, c] = parse(version);
  const [x, y, z] = parse(MINIMUM_VERSION);
  if (a !== x) {
    return a < x;
  }
  if (b !== y) {
    return b < y;
  }
  return c < z;
}

function cachedPath(context: vscode.ExtensionContext): string {
  const name = process.platform === "win32" ? "og.exe" : "og";
  return path.join(context.globalStorageUri.fsPath, "bin", name);
}

/** The GoReleaser asset for this platform: og_<version>_<os>_<arch>.<ext> */
function assetName(version: string): string | undefined {
  const goos = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform as string];
  const goarch = { x64: "amd64", arm64: "arm64" }[process.arch as string];
  if (!goos || !goarch) {
    return undefined;
  }
  const ext = goos === "windows" ? "zip" : "tar.gz";
  return `og_${version}_${goos}_${goarch}.${ext}`;
}

/**
 * download fetches the latest release, verifies its checksum and caches it.
 *
 * The checksum is not decoration. This puts an executable on the user's machine
 * and then runs it against their production platform; taking whatever arrives
 * over the network on trust would be the wrong trade for saving twenty lines.
 */
async function download(context: vscode.ExtensionContext): Promise<string | undefined> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "og: downloading the CLI", cancellable: false },
    async (progress) => {
      try {
        progress.report({ message: "finding the latest release" });
        const release = (await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`)) as {
          tag_name?: string;
        };
        const version = (release.tag_name ?? "").replace(/^v/, "");
        if (!version) {
          throw new Error("the latest release has no tag");
        }

        const asset = assetName(version);
        if (!asset) {
          throw new Error(`no build for ${process.platform}/${process.arch}`);
        }
        const base = `https://github.com/${REPO}/releases/download/v${version}`;

        progress.report({ message: `fetching ${asset}` });
        const archive = await fetchBuffer(`${base}/${asset}`);

        progress.report({ message: "verifying the checksum" });
        const checksums = await fetchText(`${base}/checksums.txt`);
        const expected = checksumFor(checksums, asset);
        if (!expected) {
          throw new Error(`checksums.txt does not list ${asset}`);
        }
        const actual = crypto.createHash("sha256").update(archive).digest("hex");
        if (actual !== expected) {
          throw new Error(`checksum mismatch for ${asset} — refusing to install it`);
        }

        progress.report({ message: "unpacking" });
        const binDir = path.join(context.globalStorageUri.fsPath, "bin");
        await fs.promises.mkdir(binDir, { recursive: true });
        const archivePath = path.join(binDir, asset);
        await fs.promises.writeFile(archivePath, archive);
        await unpack(archivePath, binDir);
        await fs.promises.rm(archivePath, { force: true });

        const bin = cachedPath(context);
        if (process.platform !== "win32") {
          await fs.promises.chmod(bin, 0o755);
        }
        if (!(await versionOf(bin))) {
          throw new Error("the downloaded binary does not run");
        }

        void vscode.window.showInformationMessage(`og ${version} installed for this extension.`);
        return bin;
      } catch (error) {
        void vscode.window.showErrorMessage(
          `og: could not install the CLI — ${error instanceof Error ? error.message : String(error)}\n` +
            `Install it yourself from https://github.com/${REPO}/releases and set og.path.`,
        );
        return undefined;
      }
    },
  );
}

/** checksumFor reads one entry out of GoReleaser's `<sha256>  <file>` list. */
function checksumFor(checksums: string, asset: string): string | undefined {
  for (const line of checksums.split("\n")) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === asset) {
      return hash;
    }
  }
  return undefined;
}

/**
 * unpack extracts the archive with the tool the platform already has.
 *
 * Bundling an extractor would mean shipping a dependency to save a call to
 * something every supported platform provides: bsdtar since Windows 10 1803,
 * tar everywhere else.
 */
function unpack(archive: string, dir: string): Promise<void> {
  const [command, args] =
    process.platform === "win32"
      ? ["powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dir}' -Force`]]
      : ["tar", ["-xzf", archive, "-C", dir]];

  return new Promise((done, fail) => {
    execFile(command as string, args as string[], { timeout: 120000 }, (error) => {
      if (error) {
        fail(new Error(`unpacking failed: ${error.message}`));
        return;
      }
      done();
    });
  });
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse((await get(url, "application/vnd.github+json")).toString("utf8"));
}

async function fetchText(url: string): Promise<string> {
  return (await get(url, "text/plain")).toString("utf8");
}

async function fetchBuffer(url: string): Promise<Buffer> {
  return get(url, "application/octet-stream");
}

/**
 * get fetches a URL with the Accept the endpoint expects.
 *
 * One Accept for everything does not work: GitHub's API answers 415 Unsupported
 * Media Type to `application/octet-stream` on the releases endpoint, which is
 * the header the asset download needs. Sending the right one per call is the
 * whole of it.
 */
async function get(url: string, accept: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": "og-vscode", Accept: accept },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** describe reports where the binary came from, for the status line and health. */
export function describe(): string {
  return resolved ?? "not resolved";
}
