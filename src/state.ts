import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_PATH, STATE_VERSION } from "./constants.js";
import { log } from "./log.js";

/** What the AI produced for one repository, with the hash of the input it was produced from. */
export interface RepoAnnotation {
  /** Hash of the inputs the category was picked from (and of the taxonomy). */
  ch?: string;
  category?: string;
  /** Hash of the inputs the description was written from (and of the language). */
  dh?: string;
  description?: string;
}

export interface Taxonomy {
  categories: string[];
  source: "config" | "ai";
}

export interface Digest {
  text: string;
  /** Newest starredAt the digest covers: a newer star triggers a new digest. */
  upTo: string;
  language: string;
}

/**
 * Persistent state, committed next to the outputs. It is what keeps runs cheap and diffs small:
 * AI work is cached per repository, and the "Updated" date only moves when the content does.
 */
export interface State {
  version: number;
  /** Date shown in the "Updated" badge: the last day the rendered content changed. */
  updatedAt: string | null;
  /** Hash of the rendered content, without the date. */
  contentHash: string | null;
  /** Files written by the last run, so files a new run no longer writes get deleted. */
  files: string[];
  /** Newest starredAt seen, to count the stars added since the previous run. */
  newest: string | null;
  taxonomy: Taxonomy | null;
  digest: Digest | null;
  repos: Record<string, RepoAnnotation>;
}

export function emptyState(): State {
  return {
    version: STATE_VERSION,
    updatedAt: null,
    contentHash: null,
    files: [],
    newest: null,
    taxonomy: null,
    digest: null,
    repos: {},
  };
}

export function hash(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
}

export function loadState(workspace: string): State {
  const full = join(workspace, STATE_PATH);
  if (!existsSync(full)) return emptyState();
  try {
    const data = JSON.parse(readFileSync(full, "utf8")) as Partial<State>;
    if (data.version !== STATE_VERSION) {
      log.warn(`Ignoring ${STATE_PATH}: version ${data.version} is not ${STATE_VERSION}`);
      return emptyState();
    }
    return { ...emptyState(), ...data, repos: data.repos ?? {} };
  } catch (error) {
    log.warn(`Ignoring unreadable ${STATE_PATH}: ${(error as Error).message}`);
    return emptyState();
  }
}

/** Drop annotations of repositories that are no longer starred. */
export function pruneState(state: State, ids: Set<string>): void {
  for (const id of Object.keys(state.repos)) if (!ids.has(id)) delete state.repos[id];
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Stable serialization: sorted keys, so an unchanged state is byte-for-byte identical. */
export function serializeState(state: State): string {
  const repos = Object.fromEntries(
    Object.entries(state.repos).filter(([, a]) => a.category !== undefined || a.description !== undefined),
  );
  return `${JSON.stringify(sortKeys({ ...state, repos }), null, 2)}\n`;
}
