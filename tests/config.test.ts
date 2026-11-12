import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, readActionInputs, readConfigFile, resolveConfig } from "../src/config.js";
import { tempDir } from "./helpers.js";

describe("resolveConfig", () => {
  test("defaults", () => {
    const c = resolveConfig({});
    expect(c.output).toBe("README.md");
    expect(c.groupBy).toBe("language");
    expect(c.starFormat).toBe("compact");
    expect(c.columns).toEqual(["name", "description", "author", "stars"]);
    expect(c.ai.enabled).toBe(false);
    expect(c.ai.provider).toBe("github-models");
    expect(c.ai.minIntervalMs).toBe(4500);
    expect(c.ai.language).toBe("en");
  });

  test("later layers win, strings are coerced", () => {
    const c = resolveConfig(
      { "group-by": "topic", "min-stars": 10, columns: ["name", "stars"] },
      { "min-stars": "50", "exclude-archived": "yes", "ai-categories": "Web, CLI\nData" },
    );
    expect(c.groupBy).toBe("topic");
    expect(c.filters.minStars).toBe(50);
    expect(c.filters.excludeArchived).toBe(true);
    expect(c.columns).toEqual(["name", "stars"]);
    expect(c.ai.categories).toEqual(["Web", "CLI", "Data"]);
  });

  test("ai-language follows locale unless set", () => {
    expect(resolveConfig({ locale: "fr" }).ai.language).toBe("fr");
    expect(resolveConfig({ locale: "fr", "ai-language": "de" }).ai.language).toBe("de");
  });

  test("rejects typos and bad values", () => {
    expect(() => resolveConfig({ "group-bye": "x" })).toThrow(/Unknown option/);
    expect(() => resolveConfig({ "group-by": "colour" })).toThrow(/Invalid options/);
    expect(() => resolveConfig({ columns: "name,nope" })).toThrow(/Invalid options/);
  });
});

test("readActionInputs reads INPUT_ env vars and skips empty ones", () => {
  const raw = readActionInputs({ "INPUT_GROUP-BY": "topic", "INPUT_MIN-STARS": " ", INPUT_TOKEN: "abc" });
  expect(raw).toEqual({ "group-by": "topic", token: "abc" });
});

test("parseArgs", () => {
  expect(parseArgs(["--dry-run", "--group-by", "topic", "--min-stars=5", "--no-stats"])).toEqual({
    "dry-run": "true",
    "group-by": "topic",
    "min-stars": "5",
    stats: "false",
  });
});

test("readConfigFile reads YAML with overrides", () => {
  const dir = tempDir();
  const path = join(dir, "c.yml");
  writeFileSync(
    path,
    "group-by: ai-category\npinned:\n  - a/b\noverrides:\n  a/b:\n    category: Tools\n    hide: false\n",
  );
  const c = resolveConfig(readConfigFile(dir, "c.yml"));
  expect(c.groupBy).toBe("ai-category");
  expect(c.pinned).toEqual(["a/b"]);
  expect(c.overrides["a/b"]).toEqual({ category: "Tools", hide: false });
  expect(readConfigFile(dir, "missing.yml")).toEqual({});
});
