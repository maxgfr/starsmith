import type { Config } from "../config.js";
import type { Repo } from "../types.js";

/** `*` matches any run of characters (`/` included), the match ignores case. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesAny(value: string, globs: RegExp[]): boolean {
  return globs.some((g) => g.test(value));
}

/** The repositories the config keeps, in their input order. */
export function filterRepos(repos: Repo[], config: Config, username: string): Repo[] {
  const f = config.filters;
  const include = f.include.map(globToRegExp);
  const exclude = f.exclude.map(globToRegExp);
  const login = username.toLowerCase();
  return repos.filter((repo) => {
    if (config.overrides[repo.nameWithOwner]?.hide) return false;
    if (f.excludeArchived && repo.archived) return false;
    if (f.excludeForks && repo.fork) return false;
    if (f.excludeOwn && repo.owner.toLowerCase() === login) return false;
    if (repo.stars < f.minStars) return false;
    if (include.length && !matchesAny(repo.nameWithOwner, include)) return false;
    if (exclude.length && matchesAny(repo.nameWithOwner, exclude)) return false;
    if (f.excludeTopics.length && repo.topics.some((t) => f.excludeTopics.includes(t.toLowerCase())))
      return false;
    if (f.languages.length && !f.languages.includes((repo.language ?? "").toLowerCase())) return false;
    return true;
  });
}
