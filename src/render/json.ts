import { TOOL_NAME } from "../constants.js";
import type { Group } from "../types.js";
import { UPDATED } from "./format.js";

export interface JsonRepo {
  name: string;
  url: string;
  description: string | null;
  /** GitHub's description, only when the one shown differs (AI rewrite or override). */
  originalDescription: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  license: string | null;
  archived: boolean;
  fork: boolean;
  /** Month of the last push ("2026-11"): finer would change the file every day. */
  pushedAt: string | null;
  starredAt: string;
  category: string | null;
  /** Groups the repository is listed under (several with `group-by: list`). */
  groups: string[];
  badges: string[];
}

/** Three significant digits above 1000, so star counts drift less often than every run. */
export function roundStars(n: number, style: "compact" | "exact"): number {
  if (style === "exact" || n < 1000) return n;
  const magnitude = 10 ** (Math.floor(Math.log10(n)) - 2);
  return Math.round(n / magnitude) * magnitude;
}

/** Every listed repository once, with what the pipeline derived, in Markdown order. */
export function jsonRepos(
  groups: Group[],
  labelOf: (name: string) => string,
  starFormat: "compact" | "exact",
): JsonRepo[] {
  const byId = new Map<string, JsonRepo>();
  for (const g of groups) {
    for (const e of g.entries) {
      const known = byId.get(e.id);
      if (known) {
        known.groups.push(labelOf(g.name));
        continue;
      }
      byId.set(e.id, {
        name: e.nameWithOwner,
        url: e.url,
        description: e.displayDescription,
        originalDescription: e.description !== e.displayDescription ? e.description : null,
        homepage: e.homepageUrl,
        language: e.language,
        topics: e.topics,
        stars: roundStars(e.stars, starFormat),
        license: e.license,
        archived: e.archived,
        fork: e.fork,
        pushedAt: e.pushedAt ? e.pushedAt.slice(0, 7) : null,
        starredAt: e.starredAt,
        category: e.category,
        groups: [labelOf(g.name)],
        badges: e.badges,
      });
    }
  }
  return [...byId.values()];
}

/** One repository per line: a changed repository is a one-line diff. */
export function reposToLines(repos: JsonRepo[]): string {
  return `[\n${repos.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
}

export function renderJson(username: string, repos: JsonRepo[]): string {
  const head = JSON.stringify({
    generator: TOOL_NAME,
    user: username,
    updated: UPDATED,
    total: repos.length,
  });
  return `${head.slice(0, -1)},"repos":${reposToLines(repos)}}\n`;
}
