import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { AiClient } from "./ai/client.js";
import { categoryCoverage, categoryOf, describedOf, digestWindow, runAi } from "./ai/index.js";
import type { Config } from "./config.js";
import { STATE_PATH } from "./constants.js";
import type { GraphqlFn, RestFn } from "./github/client.js";
import { commitFiles, type FileChange } from "./github/commit.js";
import { fetchStars } from "./github/stars.js";
import { messages } from "./i18n/index.js";
import { log } from "./log.js";
import { badgesFor } from "./pipeline/badges.js";
import { filterRepos } from "./pipeline/filter.js";
import { type GroupMode, groupEntries } from "./pipeline/group.js";
import { byStarredDesc } from "./pipeline/sort.js";
import { renderFeed } from "./render/feed.js";
import { shieldsText, UPDATED, UPDATED_BADGE } from "./render/format.js";
import { renderHtml } from "./render/html.js";
import { jsonRepos, renderJson } from "./render/json.js";
import { groupLabel, type OutputFile, renderMarkdown } from "./render/markdown.js";
import { hash, loadState, pruneState, type State, serializeState } from "./state.js";
import type { Entry, Repo, StarsData } from "./types.js";

export interface RunOptions {
  config: Config;
  workspace: string;
  gql: GraphqlFn;
  /** REST client; only needed when fetchData is not given. */
  rest?: RestFn;
  /** owner/name of the repository to commit to; no commit without it. */
  repository?: string;
  /** YYYY-MM-DD, UTC. */
  today?: string;
  /** Inject data instead of calling GitHub (tests). */
  fetchData?: () => Promise<StarsData>;
  /** Inject an AI client, or null for none (tests). */
  aiClient?: AiClient | null;
}

export interface RunResult {
  changed: boolean;
  total: number;
  newStars: number;
  groupBy: GroupMode;
  files: string[];
  /** Files whose contents differ from the workspace (null contents: deleted). */
  changes: FileChange[];
  commit: { oid: string; url: string } | null;
}

/** A workspace-relative path, refusing absolute paths and `..` escapes. */
export function safePath(path: string): string {
  const normalized = posix.normalize(path.replace(/\\/g, "/")).replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.startsWith("..") || /^[a-z]:/i.test(normalized))
    throw new Error(`Output path "${path}" must stay inside the repository`);
  return normalized;
}

function effectiveGroupMode(config: Config, repos: Repo[], state: State): GroupMode {
  if (config.groupBy !== "ai-category") return config.groupBy;
  if (!config.ai.enabled || !config.ai.features.includes("categorize")) {
    log.warn("group-by: ai-category needs ai: true with the categorize feature; grouping by language");
    return "language";
  }
  const coverage = categoryCoverage(repos, state);
  if (coverage < config.ai.minCoverage) {
    log.warn(
      `AI categories cover ${Math.round(coverage * 100)}% of the stars (ai-min-coverage: ${Math.round(config.ai.minCoverage * 100)}%); grouping by language until then`,
    );
    return "language";
  }
  return "ai-category";
}

function toEntries(repos: Repo[], config: Config, state: State, today: string): Entry[] {
  const ai = config.ai;
  const useCategories = ai.enabled && ai.features.includes("categorize");
  const useDescriptions = ai.enabled && ai.features.includes("describe");
  return repos.map((repo) => {
    const override = config.overrides[repo.nameWithOwner];
    return {
      ...repo,
      displayDescription:
        override?.description ??
        (useDescriptions ? describedOf(repo, state, ai.language) : null) ??
        repo.description,
      category: override?.category ?? (useCategories ? categoryOf(repo, state) : null),
      badges: badgesFor(repo, config, today),
    };
  });
}

function readWorkspaceFile(workspace: string, path: string): string | null {
  const full = join(workspace, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

export async function run(options: RunOptions): Promise<RunResult> {
  const { config, workspace } = options;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const username = config.username;
  if (!username) throw new Error("No username: set the username input");
  const t = messages(config.locale);

  const data = await log.group("Fetch stars", () =>
    options.fetchData
      ? options.fetchData()
      : fetchStars(options.rest as RestFn, options.gql, username, config.groupBy === "list"),
  );
  const state = loadState(workspace);
  pruneState(state, new Set(data.repos.map((r) => r.id)));
  const repos = filterRepos(data.repos, config, username);
  const newest = byStarredDesc(data.repos)[0]?.starredAt ?? null;
  const newStars = state.newest ? data.repos.filter((r) => r.starredAt > (state.newest as string)).length : 0;
  state.newest = newest;
  log.info(`${repos.length} of ${data.repos.length} stars kept by the filters, ${newStars} new`);

  if (config.ai.enabled) {
    await log.group("AI", () => runAi(repos, state, config.ai, { today, client: options.aiClient }));
  }

  const mode = effectiveGroupMode(config, repos, state);
  const entries = toEntries(repos, config, state, today);
  const groups = groupEntries(entries, mode, config, data.lists);
  const byName = new Map(entries.map((e) => [e.nameWithOwner.toLowerCase(), e]));
  const pinned = config.pinned.map((n) => byName.get(n.toLowerCase())).filter((e): e is Entry => !!e);
  const recent = config.recentCount > 0 ? byStarredDesc(entries).slice(0, config.recentCount) : [];
  const useDigest = config.ai.enabled && config.ai.features.includes("digest") && state.digest;
  const digest = useDigest
    ? {
        text: (state.digest as NonNullable<State["digest"]>).text,
        count: digestWindow(repos, config.ai, today).length,
        days: config.ai.digestDays,
      }
    : null;

  const outputs: OutputFile[] = renderMarkdown({
    config: { ...config, output: safePath(config.output) },
    t,
    username,
    entries,
    groups,
    pinned,
    recent,
    digest,
    siteUrl: config.siteUrl || undefined,
  });
  const labelOf = (name: string) => groupLabel(name, t);
  const json = jsonRepos(groups, labelOf, config.starFormat);
  if (config.jsonOutput) outputs.push({ path: config.jsonOutput, contents: renderJson(username, json) });
  if (config.htmlOutput) {
    const htmlDir = posix.dirname(safePath(config.htmlOutput));
    const relative = (path: string) => (path ? posix.relative(htmlDir, safePath(path)) : null);
    outputs.push({
      path: config.htmlOutput,
      contents: renderHtml({
        title: config.title,
        description: config.description,
        locale: config.locale,
        username,
        repos: json,
        groups: groups.map((g) => ({ name: labelOf(g.name), count: g.entries.length })),
        digest: digest?.text ?? null,
        t,
        siteUrl: config.siteUrl || null,
        feedHref: relative(config.feedOutput),
        jsonHref: relative(config.jsonOutput),
        sourceRepo: options.repository ?? null,
      }),
    });
  }
  // GitHub Pages runs Jekyll on a branch source unless told not to.
  if (config.siteDir) outputs.push({ path: `${config.siteDir}/.nojekyll`, contents: "" });
  if (config.feedOutput) {
    const feedEntries = byStarredDesc(entries).slice(0, config.feedSize);
    outputs.push({
      path: config.feedOutput,
      contents: renderFeed(feedEntries, {
        username,
        siteUrl: config.siteUrl || `https://github.com/${username}?tab=stars`,
        t,
      }),
    });
  }

  for (const file of outputs) file.path = safePath(file.path);
  const paths = outputs.map((f) => f.path);
  const duplicate = paths.find((p, i) => paths.indexOf(p) !== i);
  if (duplicate) throw new Error(`Two outputs write ${duplicate}`);

  // The date only moves when the content does, so an idle day commits nothing.
  const contentHash = hash(outputs.map((f) => [f.path, f.contents]));
  if (contentHash !== state.contentHash || !state.updatedAt) {
    state.contentHash = contentHash;
    state.updatedAt = today;
  }
  const date = state.updatedAt as string;
  for (const file of outputs) {
    file.contents = file.contents.replaceAll(UPDATED_BADGE, shieldsText(date)).replaceAll(UPDATED, date);
  }

  const previous = state.files;
  state.files = [...paths].sort();
  outputs.push({ path: STATE_PATH, contents: serializeState(state) });

  const changes: FileChange[] = outputs
    .filter((f) => readWorkspaceFile(workspace, f.path) !== f.contents)
    .map((f) => ({ path: f.path, contents: f.contents }));
  for (const stale of previous) {
    const path = safePath(stale);
    if (!paths.includes(path) && existsSync(join(workspace, path))) changes.push({ path, contents: null });
  }

  const result: RunResult = {
    changed: changes.length > 0,
    total: repos.length,
    newStars,
    groupBy: mode,
    files: outputs.map((f) => f.path),
    changes,
    commit: null,
  };

  if (!changes.length) {
    log.info("Nothing changed");
    return result;
  }
  log.info(`${changes.length} file(s) changed: ${changes.map((c) => c.path).join(", ")}`);
  if (config.dryRun) {
    log.info("Dry run: nothing written");
    return result;
  }

  for (const change of changes) {
    const full = join(workspace, change.path);
    if (change.contents === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, change.contents);
    }
  }

  if (config.commit && options.repository) {
    const commit = await log.group("Commit", () =>
      commitFiles(options.gql, {
        repository: options.repository as string,
        branch: config.branch || undefined,
        message: config.message,
        changes,
      }),
    );
    log.info(`Committed ${commit.oid.slice(0, 7)} to ${commit.branch}: ${commit.url}`);
    result.commit = { oid: commit.oid, url: commit.url };
  }
  return result;
}
