import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AiClient, BudgetExhausted } from "../src/ai/client.js";
import { type Config, resolveConfig } from "../src/config.js";
import type { GraphqlFn } from "../src/github/client.js";
import { log } from "../src/log.js";
import type { Repo } from "../src/types.js";

log.setQuiet(true);

let counter = 0;

export function repo(overrides: Partial<Repo> & { nameWithOwner: string }): Repo {
  const [owner = "o", name = "r"] = overrides.nameWithOwner.split("/");
  counter++;
  return {
    id: `R_${overrides.nameWithOwner}`,
    name,
    owner,
    url: `https://github.com/${overrides.nameWithOwner}`,
    description: `Description of ${name}`,
    homepageUrl: null,
    language: "TypeScript",
    topics: [],
    stars: 100 + counter,
    forks: 1,
    license: "MIT",
    archived: false,
    fork: false,
    pushedAt: "2026-10-01T00:00:00Z",
    createdAt: "2020-01-01T00:00:00Z",
    starredAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export const REPOS: Repo[] = [
  repo({
    nameWithOwner: "vercel/next.js",
    language: "JavaScript",
    stars: 131_234,
    topics: ["react", "ssr"],
    starredAt: "2026-11-10T10:00:00Z",
  }),
  repo({
    nameWithOwner: "facebook/react",
    language: "JavaScript",
    stars: 240_100,
    topics: ["react", "ui"],
    starredAt: "2025-03-02T00:00:00Z",
  }),
  repo({
    nameWithOwner: "denoland/deno",
    language: "Rust",
    stars: 104_000,
    topics: ["runtime"],
    starredAt: "2024-05-05T00:00:00Z",
  }),
  repo({
    nameWithOwner: "BurntSushi/ripgrep",
    language: "Rust",
    stars: 55_000,
    topics: ["cli", "search"],
    starredAt: "2023-07-07T00:00:00Z",
  }),
  repo({
    nameWithOwner: "old/archived-thing",
    language: "C",
    stars: 900,
    archived: true,
    pushedAt: "2018-01-01T00:00:00Z",
    starredAt: "2019-01-01T00:00:00Z",
    description: "Pipes | and <tags> [brackets]",
  }),
  repo({
    nameWithOwner: "me/my-fork",
    language: "C#",
    stars: 3,
    fork: true,
    starredAt: "2022-02-02T00:00:00Z",
  }),
  repo({
    nameWithOwner: "someone/cpp-lib",
    language: "C++",
    stars: 1_500,
    starredAt: "2021-02-02T00:00:00Z",
  }),
  repo({
    nameWithOwner: "x/no-lang",
    language: null,
    description: null,
    stars: 10,
    starredAt: "2020-02-02T00:00:00Z",
  }),
];

export function config(options: Record<string, unknown> = {}): Config {
  return resolveConfig({ username: "me", token: "t", ...options });
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "starsmith-test-"));
}

export const noGraphql: GraphqlFn = async () => {
  throw new Error("GitHub should not be called in this test");
};

/** An AI client answering from a function, counting calls. */
export function fakeAi(
  answer: (prompt: string, kind: "json" | "text") => unknown,
  maxCalls = 100,
): AiClient & { calls: number } {
  const client = {
    calls: 0,
    label: "fake",
    remaining: () => Math.max(0, maxCalls - client.calls),
    json: async <T>({ prompt }: { prompt: string }) => {
      if (client.calls >= maxCalls) throw new BudgetExhausted("test budget");
      client.calls++;
      return answer(prompt, "json") as T;
    },
    text: async ({ prompt }: { prompt: string }) => {
      if (client.calls >= maxCalls) throw new BudgetExhausted("test budget");
      client.calls++;
      return String(answer(prompt, "text"));
    },
  };
  return client;
}
