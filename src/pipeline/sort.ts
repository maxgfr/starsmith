import type { Config } from "../config.js";
import type { Repo } from "../types.js";

const byName = (a: Repo, b: Repo) =>
  a.nameWithOwner.toLowerCase().localeCompare(b.nameWithOwner.toLowerCase(), "en") ||
  a.id.localeCompare(b.id);

/**
 * A total order: ties on the sort key are broken by name, then id, so the same stars always
 * render in the same order and unchanged lists produce no diff.
 */
export function compareRepos(sort: Config["sort"], order: Config["order"]): (a: Repo, b: Repo) => number {
  const dir = order === "asc" ? 1 : -1;
  const key = (r: Repo): number | string => {
    switch (sort) {
      case "stars":
        return r.stars;
      case "starred-at":
        return r.starredAt;
      case "pushed-at":
        return r.pushedAt ?? "";
      case "name":
        return r.nameWithOwner.toLowerCase();
    }
  };
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) {
      const cmp = typeof ka === "number" ? ka - (kb as number) : String(ka).localeCompare(String(kb), "en");
      if (cmp !== 0) return cmp * dir;
    }
    return byName(a, b);
  };
}

export function sortRepos<T extends Repo>(repos: T[], sort: Config["sort"], order: Config["order"]): T[] {
  return [...repos].sort(compareRepos(sort, order));
}

/** Newest stars first, for "recently starred" sections and feeds. */
export function byStarredDesc<T extends Repo>(repos: T[]): T[] {
  return sortRepos(repos, "starred-at", "desc");
}
