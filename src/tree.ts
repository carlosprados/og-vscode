// The platform, as a tree.
//
// Everything else in this extension acts on an artifact you already have. This
// is the part that answers the question before that one: what is out there, and
// how do I get it here.
//
// Populated entirely from `-o json`. The listing subcommand is not the same
// word for every family — rules `search`, the others `list` — which is a CLI
// asymmetry this has to know about and nothing else does.

import * as path from "node:path";
import * as vscode from "vscode";
import * as cli from "./cli";

interface FamilySpec {
  label: string;
  /** og subcommand group. */
  command: string;
  /** The listing verb, which differs per family. */
  list: string;
  /** Field holding the identifier in a listing entry. */
  idKey: string;
  icon: string;
  /** Metadata filename, for finding an already-pulled copy. */
  meta: string;
}

const FAMILIES: FamilySpec[] = [
  { label: "Rules", command: "rules", list: "search", idKey: "identifier", icon: "law", meta: "rule.json" },
  { label: "Connector functions", command: "connectors", list: "list", idKey: "identifier", icon: "plug", meta: "connectorfunction.json" },
  { label: "Provision functions", command: "provision", list: "list", idKey: "provisionProcessorId", icon: "server-process", meta: "provisionfunction.json" },
  { label: "Workspaces", command: "workspace", list: "list", idKey: "_id", icon: "dashboard", meta: "workspace.json" },
];

type Node = FamilyNode | ArtifactNode | MessageNode;

interface FamilyNode {
  type: "family";
  spec: FamilySpec;
}

export interface ArtifactNode {
  type: "artifact";
  spec: FamilySpec;
  id: string;
  name: string;
  detail: string;
  /** Path of the metadata file, when a copy is already in the workspace. */
  local?: string;
}

interface MessageNode {
  type: "message";
  text: string;
}

export class PlatformTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === "message") {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    if (node.type === "family") {
      const item = new vscode.TreeItem(node.spec.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(node.spec.icon);
      item.contextValue = "ogFamily";
      return item;
    }

    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.description = node.local ? `${node.detail} · here`.replace(/^ · /, "") : node.detail;
    item.tooltip = [
      node.spec.label.replace(/s$/, ""),
      node.name,
      node.id,
      node.local ? `pulled to ${path.dirname(node.local)}` : "not pulled yet",
    ].join("\n");
    item.iconPath = new vscode.ThemeIcon(node.local ? "file-code" : "cloud");
    // The menu differs by whether it is here: offering Deploy on something you
    // have not pulled is offering to deploy nothing.
    item.contextValue = node.local ? "ogArtifactLocal" : "ogArtifactRemote";
    item.command = { command: "og.openOrPull", title: "Open", arguments: [node] };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return FAMILIES.map((spec) => ({ type: "family", spec }));
    }
    if (node.type !== "family") {
      return [];
    }

    const { data, res } = await cli.runJson<unknown>([node.spec.command, node.spec.list]);
    if (res.code !== cli.EXIT_OK) {
      // Shown in the tree rather than as a notification: a failure under the
      // node that caused it is easier to connect than a toast, and workspaces
      // failing for want of a web token should not hide the other three.
      return [{ type: "message", text: firstLine(res.stderr) || `og exited ${res.code}` }];
    }

    const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    if (items.length === 0) {
      return [{ type: "message", text: "none in this organization" }];
    }

    // One scan per family rather than one per artifact: the workspace is walked
    // once and every node of this family is matched against the result.
    const here = await localCopies(node.spec.meta);

    return items
      .map((item) => {
        const id = String(item[node.spec.idKey] ?? "");
        return {
          type: "artifact" as const,
          spec: node.spec,
          id,
          name: String(item.name ?? item.title ?? id ?? "unnamed"),
          detail: describe(item),
          local: here.get(id),
        };
      })
      .filter((a) => a.id !== "")
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** describe picks the one field worth showing beside the name, per family. */
function describe(item: Record<string, unknown>): string {
  if (typeof item.mode === "string") {
    // A rule: EASY or ADVANCED decides whether it has JavaScript at all.
    return item.active === false ? `${item.mode} · inactive` : item.mode;
  }
  if (typeof item.operationalStatus === "string") {
    return item.operationalStatus;
  }
  if (typeof item.owner === "string") {
    return item.owner;
  }
  return "";
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/**
 * openOrPull opens an artifact that is already in the workspace, or offers to
 * pull it.
 *
 * Finding the local copy by its identifier rather than by name: names are not
 * unique and slugs are derived, but the identifier in the metadata is what og
 * itself matches on.
 */
export async function openOrPull(node: Node): Promise<void> {
  if (node.type !== "artifact") {
    return;
  }

  const existing = await findLocal(node.spec.meta, node.id);
  if (existing) {
    const dir = path.dirname(existing.fsPath);
    const code = await vscode.workspace.findFiles(
      new vscode.RelativePattern(dir, "*.js"),
      undefined,
      1,
    );
    const toOpen = code[0] ?? existing;
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(toOpen));
    return;
  }

  const target = await chooseTarget(node);
  if (!target) {
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `og: pulling ${node.name}` },
    async () => {
      const res = await cli.run([node.spec.command, "pull", node.id, "--dir", target]);
      if (res.code !== cli.EXIT_OK) {
        cli.reportFailure(res, `pulling ${node.name} failed`);
        return;
      }
      const pulled = await findLocal(node.spec.meta, node.id);
      if (pulled) {
        const dir = path.dirname(pulled.fsPath);
        const code = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, "*.js"), undefined, 1);
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(code[0] ?? pulled),
        );
      }
    },
  );
}

/**
 * localCopies maps identifier to metadata path for every pulled artifact of a
 * family in the workspace.
 *
 * Matched on the identifier rather than the directory name: names are not
 * unique and slugs are derived, but the identifier is what og itself matches on.
 */
async function localCopies(meta: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const candidates = await vscode.workspace.findFiles(`**/${meta}`, "**/node_modules/**", 1000);
  for (const candidate of candidates) {
    try {
      const raw = Buffer.from(await vscode.workspace.fs.readFile(candidate)).toString("utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of ["identifier", "provisionProcessorId", "_id", "i"]) {
        const value = parsed[key];
        if (typeof value === "string" && value !== "" && !found.has(value)) {
          found.set(value, candidate.fsPath);
        }
      }
    } catch {
      // A metadata file that does not parse is the validator's business, not
      // this scan's; skipping it must not abandon the rest.
    }
  }
  return found;
}

async function findLocal(meta: string, id: string): Promise<vscode.Uri | undefined> {
  const path = (await localCopies(meta)).get(id);
  return path ? vscode.Uri.file(path) : undefined;
}

/** chooseTarget asks where to put a pull, defaulting to a folder per family. */
async function chooseTarget(node: ArtifactNode): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage("og: open a folder first — there is nowhere to pull into");
    return undefined;
  }
  const root = folders[0].uri.fsPath;
  const suggested = path.join(root, node.spec.command);

  const answer = await vscode.window.showInputBox({
    title: `Pull ${node.name}`,
    prompt: "Directory to pull into",
    value: suggested,
  });
  return answer?.trim() || undefined;
}
