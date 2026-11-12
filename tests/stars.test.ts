import { expect, test } from "bun:test";
import type { RestFn } from "../src/github/client.js";
import { fetchStarredRepos, lastPage, type RestRepo } from "../src/github/stars.js";
import "./helpers.js";

const restRepo = (n: number): RestRepo => ({
  node_id: `R_${n}`,
  full_name: `o/r${n}`,
  name: `r${n}`,
  owner: { login: "o" },
  html_url: `https://github.com/o/r${n}`,
  description: `  repo\n ${n} `,
  homepage: "",
  language: n % 2 ? "Go" : null,
  topics: ["t"],
  stargazers_count: n,
  forks_count: 0,
  license: { spdx_id: n % 3 ? "MIT" : "NOASSERTION" },
  archived: false,
  fork: false,
  pushed_at: "2026-01-01T00:00:00Z",
  created_at: "2020-01-01T00:00:00Z",
});

test("lastPage reads the Link header", () => {
  const link =
    '<https://api.github.com/user/1/starred?per_page=100&page=2>; rel="next", <https://api.github.com/user/1/starred?per_page=100&page=49>; rel="last"';
  expect(lastPage(link)).toBe(49);
  expect(lastPage(null)).toBe(1);
});

test("fetches every page in parallel, keeps the order and drops duplicates", async () => {
  const requested: number[] = [];
  const rest: RestFn = async <T>(path: string) => {
    const page = Number(new URL(`https://x${path}`).searchParams.get("page"));
    requested.push(page);
    // Page 3 repeats the last star of page 2, as when a star is added mid-fetch.
    const ids = { 1: [10, 11], 2: [20, 21], 3: [21, 30] }[page] ?? [];
    return {
      data: ids.map((n) => ({ starred_at: "2026-01-01T00:00:00Z", repo: restRepo(n) })) as T,
      link: page === 1 ? '<https://x/?page=3>; rel="last"' : null,
    };
  };
  const repos = await fetchStarredRepos(rest, "o");
  expect(requested.sort()).toEqual([1, 2, 3]);
  expect(repos.map((r) => r.id)).toEqual(["R_10", "R_11", "R_20", "R_21", "R_30"]);
  expect(repos[0]).toMatchObject({
    nameWithOwner: "o/r10",
    description: "repo 10",
    homepageUrl: null,
    language: null,
    license: "MIT",
  });
  expect(repos.find((r) => r.id === "R_21")?.license).toBe(null);
});
