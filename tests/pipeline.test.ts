import { expect, test } from "bun:test";
import { OTHERS } from "../src/constants.js";
import { badgesFor } from "../src/pipeline/badges.js";
import { filterRepos, globToRegExp } from "../src/pipeline/filter.js";
import { groupEntries } from "../src/pipeline/group.js";
import { sortRepos } from "../src/pipeline/sort.js";
import type { Entry } from "../src/types.js";
import { config, REPOS, repo } from "./helpers.js";

const entries = (): Entry[] =>
  REPOS.map((r) => ({ ...r, displayDescription: r.description, category: null, badges: [] }));

test("globs match owner/name, case-insensitively", () => {
  expect(globToRegExp("vercel/*").test("Vercel/next.js")).toBe(true);
  expect(globToRegExp("*/next.js").test("vercel/next.js")).toBe(true);
  expect(globToRegExp("vercel/*").test("facebook/react")).toBe(false);
});

test("filters", () => {
  const names = (opts: Record<string, unknown>) =>
    filterRepos(REPOS, config(opts), "me").map((r) => r.nameWithOwner);
  expect(names({ "exclude-archived": true })).not.toContain("old/archived-thing");
  expect(names({ "exclude-forks": true })).not.toContain("me/my-fork");
  expect(names({ "exclude-own": true })).not.toContain("me/my-fork");
  expect(names({ "min-stars": 100_000 })).toEqual(["vercel/next.js", "facebook/react", "denoland/deno"]);
  expect(names({ include: "*/r*" })).toEqual(["facebook/react", "BurntSushi/ripgrep"]);
  expect(names({ exclude: "vercel/*,facebook/*" })).not.toContain("vercel/next.js");
  expect(names({ "exclude-topics": "React" })).not.toContain("facebook/react");
  expect(names({ languages: "rust" })).toEqual(["denoland/deno", "BurntSushi/ripgrep"]);
  expect(names({ overrides: { "denoland/deno": { hide: true } } })).not.toContain("denoland/deno");
});

test("sorting is total: ties are broken by name", () => {
  const tied = [
    repo({ nameWithOwner: "b/b", stars: 5 }),
    repo({ nameWithOwner: "a/a", stars: 5 }),
    repo({ nameWithOwner: "c/c", stars: 9 }),
  ];
  expect(sortRepos(tied, "stars", "desc").map((r) => r.nameWithOwner)).toEqual(["c/c", "a/a", "b/b"]);
  expect(sortRepos(tied, "stars", "asc").map((r) => r.nameWithOwner)).toEqual(["a/a", "b/b", "c/c"]);
  expect(sortRepos([...tied].reverse(), "stars", "desc")).toEqual(sortRepos(tied, "stars", "desc"));
});

test("group by language puts Others last", () => {
  const groups = groupEntries(entries(), "language", config());
  expect(groups.map((g) => g.name)).toEqual(["C", "C#", "C++", "JavaScript", "Rust", OTHERS]);
  expect(groups.find((g) => g.name === "JavaScript")?.entries.map((e) => e.name)).toEqual([
    "react",
    "next.js",
  ]);
});

test("group by topic lists each repo once, under its most common topic", () => {
  const groups = groupEntries(entries(), "topic", config({ "min-group-size": 2 }));
  expect(groups.map((g) => g.name)).toEqual(["react", OTHERS]);
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  expect(total).toBe(REPOS.length);
});

test("group by list allows a repo in several lists", () => {
  const lists = [
    { name: "Frontend", description: null, repoIds: ["R_vercel/next.js", "R_facebook/react"] },
    { name: "Favorites", description: null, repoIds: ["R_vercel/next.js"] },
  ];
  const groups = groupEntries(entries(), "list", config(), lists);
  expect(groups.map((g) => [g.name, g.entries.length])).toEqual([
    ["Favorites", 1],
    ["Frontend", 2],
    [OTHERS, REPOS.length - 2],
  ]);
});

test("manual categories win, small groups fold into Others, groups are capped", () => {
  const cfg = config({
    overrides: { "denoland/deno": { category: "Runtimes" } },
    "min-group-size": 2,
    "max-per-group": 1,
  });
  const groups = groupEntries(entries(), "language", cfg);
  expect(groups.map((g) => g.name)).toEqual(["JavaScript", OTHERS]);
  expect(groups[0]?.entries.length).toBe(1);
  expect(groups[0]?.hidden).toBe(1);
});

test("badges", () => {
  const cfg = config({ badges: "archived,stale,new,fork", "stale-days": 365, "new-days": 7 });
  const today = "2026-11-12";
  expect(badgesFor(REPOS[0] as never, cfg, today)).toEqual(["new"]);
  expect(badgesFor(REPOS[4] as never, cfg, today)).toEqual(["archived"]);
  expect(badgesFor(repo({ nameWithOwner: "s/s", pushedAt: "2020-01-01T00:00:00Z" }), cfg, today)).toEqual([
    "stale",
  ]);
  expect(badgesFor(REPOS[5] as never, cfg, today)).toEqual(["fork"]);
});
