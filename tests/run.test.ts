import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_PATH } from "../src/constants.js";
import { run, safePath } from "../src/run.js";
import type { Repo } from "../src/types.js";
import { config, fakeAi, noGraphql, REPOS, repo, tempDir } from "./helpers.js";

const fetchData =
  (repos: Repo[] = REPOS) =>
  async () => ({ repos, lists: [] });

async function go(
  workspace: string,
  options: Record<string, unknown> = {},
  extra: Parameters<typeof run>[0] extends infer O ? Partial<O> : never = {},
) {
  return run({
    config: config(options),
    workspace,
    gql: noGraphql,
    today: "2026-11-12",
    fetchData: fetchData(),
    ...extra,
  });
}

describe("run", () => {
  test("writes the list and its state, then a second run changes nothing", async () => {
    const ws = tempDir();
    const first = await go(ws);
    expect(first.changed).toBe(true);
    expect(first.files).toEqual(["README.md", STATE_PATH]);
    const readme = readFileSync(join(ws, "README.md"), "utf8");
    expect(readme).toContain("# Awesome Stars");
    expect(readme).toContain("Total-8-green");
    expect(readme).toContain("Updated-2026--11--12-blue");
    expect(readme).toContain(
      "| [next.js](https://github.com/vercel/next.js) | Description of next.js | vercel | 131k |",
    );
    expect(readme).toContain("- [C# (1)](#c-1)");
    expect(readme).toContain("Pipes \\| and &lt;tags&gt; \\[brackets\\]");

    const second = await go(ws, {}, { today: "2026-11-13" });
    expect(second.changed).toBe(false);
    // An idle day keeps the previous date.
    expect(readFileSync(join(ws, "README.md"), "utf8")).toBe(readme);
  });

  test("the date moves only when the content does", async () => {
    const ws = tempDir();
    await go(ws);
    const more = [...REPOS, repo({ nameWithOwner: "new/one", starredAt: "2026-11-12T08:00:00Z" })];
    const result = await go(ws, {}, { today: "2026-11-14", fetchData: fetchData(more) });
    expect(result.newStars).toBe(1);
    expect(readFileSync(join(ws, "README.md"), "utf8")).toContain("Updated-2026--11--14-blue");
  });

  test("dry run writes nothing", async () => {
    const ws = tempDir();
    const result = await go(ws, { "dry-run": true });
    expect(result.changed).toBe(true);
    expect(existsSync(join(ws, "README.md"))).toBe(false);
  });

  test("split writes one file per group and deletes the ones no longer generated", async () => {
    const ws = tempDir();
    const result = await go(ws, { split: "always", output: "STARS.md" });
    expect(result.files).toContain("stars/c-sharp.md");
    expect(result.files).toContain("stars/c-plus-plus.md");
    const index = readFileSync(join(ws, "STARS.md"), "utf8");
    expect(index).toContain("- [Rust (2)](stars/rust.md)");
    // The index keeps a preview of each group, linked to the full file.
    expect(index).toContain("## Rust");
    expect(index).toContain("**[→ All 2 repositories](stars/rust.md)**");
    expect(readFileSync(join(ws, "stars/rust.md"), "utf8")).toContain("](../STARS.md)");

    const fewer = REPOS.filter((r) => r.language !== "C#");
    const next = await go(ws, { split: "always", output: "STARS.md" }, { fetchData: fetchData(fewer) });
    expect(next.changes.find((c) => c.path === "stars/c-sharp.md")?.contents).toBeNull();
    expect(existsSync(join(ws, "stars/c-sharp.md"))).toBe(false);
  });

  test("split-preview: 0 keeps only the links", async () => {
    const ws = tempDir();
    await go(ws, { split: "always", "split-preview": 0 });
    const index = readFileSync(join(ws, "README.md"), "utf8");
    expect(index).toContain("- [Rust (2)](stars/rust.md)");
    expect(index).not.toContain("## Rust");
  });

  test("auto split past the threshold, and previews never push the index over it", async () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      repo({ nameWithOwner: `org/repo-${i}`, language: `Lang${i % 80}`, description: "x".repeat(200) }),
    );
    const ws = tempDir();
    const result = await go(
      ws,
      { "split-threshold": 30, "split-preview": 5, stats: false, "recent-count": 0 },
      { fetchData: fetchData(many) },
    );
    expect(result.files.filter((f) => f.startsWith("stars/"))).toHaveLength(80);
    const index = readFileSync(join(ws, "README.md"), "utf8");
    expect(Buffer.byteLength(index)).toBeLessThan(30_000);
    expect(index).not.toContain("→ All");

    const small = tempDir();
    const unsplit = await go(small, { "split-threshold": 5000 }, { fetchData: fetchData(many) });
    expect(unsplit.files).toEqual(["README.md", STATE_PATH]);
  });

  test("html, json and feed outputs", async () => {
    const ws = tempDir();
    await go(ws, { "html-output": "docs/index.html", "json-output": "data.json", "feed-output": "feed.xml" });
    const html = readFileSync(join(ws, "docs/index.html"), "utf8");
    expect(html).toStartWith("<!DOCTYPE html>");
    expect(html).not.toContain("<tags>");
    expect(html).toContain("\\u003ctags>");
    const data = JSON.parse(readFileSync(join(ws, "data.json"), "utf8"));
    expect(data.total).toBe(8);
    expect(data.updated).toBe("2026-11-12");
    expect(data.repos.find((r: { name: string }) => r.name === "facebook/react").stars).toBe(240_000);
    expect(readFileSync(join(ws, "feed.xml"), "utf8")).toContain("<title>vercel/next.js</title>");
  });

  test("links in the description become anchors on the site, nothing else does", async () => {
    const ws = tempDir();
    await go(ws, {
      "html-output": "index.html",
      description:
        "Built with [starsmith](https://github.com/maxgfr/starsmith) <b>x</b> [bad](javascript:alert(1))",
    });
    const html = readFileSync(join(ws, "index.html"), "utf8");
    expect(html).toContain(
      '<p class="lede">Built with <a href="https://github.com/maxgfr/starsmith">starsmith</a> &lt;b&gt;x&lt;/b&gt; [bad](javascript:alert(1))</p>',
    );
    expect(html).toContain('<meta name="description" content="Built with starsmith &lt;b&gt;x&lt;/b&gt;');
  });

  test("french locale", async () => {
    const ws = tempDir();
    await go(ws, { locale: "fr" });
    const readme = readFileSync(join(ws, "README.md"), "utf8");
    expect(readme).toContain("## Sommaire");
    expect(readme).toContain("Mis_%C3%A0_jour");
    expect(readme).toContain("| Nom | Description | Auteur | Stars |");
  });

  test("refuses outputs outside the workspace", () => {
    expect(() => safePath("../x.md")).toThrow();
    expect(() => safePath("/etc/x")).toThrow();
    expect(safePath("./docs//index.html")).toBe("docs/index.html");
  });
});

describe("run with AI", () => {
  const categories = ["Frontend", "Runtimes", "Developer Tools"];
  const answer = (prompt: string, kind: "json" | "text") => {
    if (kind === "text") return "Lately: **frontend** work, with next.js.";
    if (prompt.includes("Propose 12 to 30 categories")) return { categories };
    const lines = prompt.split("\n").filter((l) => /^\d+\. /.test(l));
    if (prompt.includes("Categories:")) {
      return {
        items: lines.map((l, i) => ({
          n: i + 1,
          category: /react|next/.test(l) ? "frontend" : /deno/.test(l) ? "Runtimes" : "Other",
        })),
      };
    }
    return { items: lines.map((_, i) => ({ n: i + 1, description: `"AI summary ${i + 1}"` })) };
  };

  test("categorizes, describes and digests, then caches everything", async () => {
    const ws = tempDir();
    const ai = fakeAi(answer);
    const options = { ai: true, "group-by": "ai-category", "ai-batch-size": 3 };
    const result = await go(ws, options, { aiClient: ai });
    expect(result.groupBy).toBe("ai-category");
    // 1 taxonomy + 3 category batches + 3 description batches (no-lang has no description) + 1 digest
    expect(ai.calls).toBe(8);
    const readme = readFileSync(join(ws, "README.md"), "utf8");
    expect(readme).toContain("## Frontend");
    expect(readme).toContain("## Runtimes");
    expect(readme).toContain("## Others");
    expect(readme).toContain("AI summary");
    expect(readme).not.toContain('"AI summary');
    expect(readme).toContain("## ✨ Digest");
    const state = JSON.parse(readFileSync(join(ws, STATE_PATH), "utf8"));
    expect(state.taxonomy).toEqual({ categories, source: "ai" });

    const split = tempDir();
    await go(split, { ...options, split: "always" }, { aiClient: fakeAi(answer) });
    expect(existsSync(join(split, "stars/frontend.md"))).toBe(true);
    expect(readFileSync(join(split, "stars/runtimes.md"), "utf8")).toContain("# Runtimes");

    const again = fakeAi(answer);
    const second = await go(ws, options, { aiClient: again });
    expect(again.calls).toBe(0);
    expect(second.changed).toBe(false);
  });

  test("falls back to language grouping until categories cover enough stars", async () => {
    const ws = tempDir();
    // Budget for the taxonomy and one batch only.
    const ai = fakeAi(answer, 2);
    const result = await go(
      ws,
      { ai: true, "group-by": "ai-category", "ai-batch-size": 2, "ai-features": "categorize" },
      { aiClient: ai },
    );
    expect(result.groupBy).toBe("language");
    const next = await go(
      ws,
      { ai: true, "group-by": "ai-category", "ai-batch-size": 2, "ai-features": "categorize" },
      { aiClient: fakeAi(answer) },
    );
    expect(next.groupBy).toBe("ai-category");
  });

  test("configured categories replace the derived ones", async () => {
    const ws = tempDir();
    const ai = fakeAi(answer);
    await go(
      ws,
      { ai: true, "ai-features": "categorize", "ai-categories": "Frontend,Runtimes" },
      { aiClient: ai },
    );
    const state = JSON.parse(readFileSync(join(ws, STATE_PATH), "utf8"));
    expect(state.taxonomy).toEqual({ categories: ["Frontend", "Runtimes"], source: "config" });
    expect(ai.calls).toBe(1);
  });

  test("an AI failure never fails the run", async () => {
    const ws = tempDir();
    const broken = fakeAi(() => {
      throw new Error("boom");
    });
    const result = await go(ws, { ai: true, "group-by": "ai-category" }, { aiClient: broken });
    expect(result.groupBy).toBe("language");
    expect(readFileSync(join(ws, "README.md"), "utf8")).toContain("## Rust");
  });

  test("a corrupt state file is ignored", async () => {
    const ws = tempDir();
    await go(ws);
    writeFileSync(join(ws, STATE_PATH), "{not json");
    const result = await go(ws);
    expect(result.changes.map((c) => c.path)).toEqual([STATE_PATH]);
  });
});
