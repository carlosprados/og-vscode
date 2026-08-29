// Working out which artifact a document belongs to.
//
// Every command acts on "the artifact I am editing", so this is the piece the
// rest depends on. It mirrors what the CLI does: walk up from the file until a
// directory holds a family's metadata file. The nearest one wins, which is what
// makes editing a widget act on that widget rather than on the workspace three
// levels above it.

import * as fs from "node:fs";
import * as path from "node:path";

export interface Family {
  kind: string;
  /** Metadata filename that marks an artifact directory. */
  meta: string;
  /** og subcommand for this family. */
  command: string;
  /** Field in the metadata holding the identifier. */
  idKey: string;
  /** Whether `og <command> validate` exists for it. */
  validatable: boolean;
}

/**
 * Ordered most specific first, so a widget directory inside a dashboard
 * resolves to the widget.
 */
export const FAMILIES: Family[] = [
  { kind: "widget", meta: "widget.json", command: "widget", idKey: "i", validatable: false },
  { kind: "dashboard", meta: "dashboard.json", command: "dashboard", idKey: "_id", validatable: false },
  { kind: "rule", meta: "rule.json", command: "rules", idKey: "identifier", validatable: true },
  { kind: "connector-function", meta: "connectorfunction.json", command: "connectors", idKey: "identifier", validatable: true },
  { kind: "provision-function", meta: "provisionfunction.json", command: "provision", idKey: "provisionProcessorId", validatable: true },
  { kind: "workspace", meta: "workspace.json", command: "workspace", idKey: "_id", validatable: false },
];

export interface Artifact {
  dir: string;
  family: Family;
  id: string | undefined;
  meta: Record<string, unknown> | undefined;
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * find resolves the artifact a path belongs to, or undefined.
 *
 * Walks to the filesystem root rather than stopping at the workspace folder: a
 * file opened by absolute path from elsewhere is an ordinary case, and stopping
 * early would fail it.
 */
export function find(filePath: string): Artifact | undefined {
  let dir = filePath;
  try {
    if (!fs.statSync(dir).isDirectory()) {
      dir = path.dirname(dir);
    }
  } catch {
    dir = path.dirname(dir);
  }

  for (;;) {
    for (const family of FAMILIES) {
      const metaPath = path.join(dir, family.meta);
      if (fs.existsSync(metaPath)) {
        const meta = readJson(metaPath);
        let id = meta?.[family.idKey];
        // A widget's identifier lives in two places depending on how the
        // dashboard was authored; the definition is the reliable one.
        if ((id === undefined || id === "") && meta && typeof meta.definition === "object" && meta.definition) {
          id = (meta.definition as Record<string, unknown>).wid;
        }
        return { dir, family, id: typeof id === "string" && id !== "" ? id : undefined, meta };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * codeFile returns a path relative to its artifact directory.
 *
 * That relative name is how og addresses a remote file, so it is what
 * `og <family> show --path` needs.
 */
export function codeFile(artifact: Artifact, filePath: string): string | undefined {
  const rel = path.relative(artifact.dir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return undefined;
  }
  // og writes the same separators on every platform.
  return rel.split(path.sep).join("/");
}
