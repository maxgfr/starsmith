import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CONFIG_PATH } from "./constants.js";

/** Raw option values keyed by their kebab-case name, before validation. */
export type RawOptions = Record<string, unknown>;

const bool = (fallback: boolean) =>
  z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (v === undefined || v === null || v === "") return undefined;
    const s = String(v).trim().toLowerCase();
    if (["true", "yes", "on", "1"].includes(s)) return true;
    if (["false", "no", "off", "0"].includes(s)) return false;
    return v;
  }, z.boolean().default(fallback));

const int = (fallback: number, min = 0) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : Number(v)),
    z.number().int().min(min).default(fallback),
  );

const ratio = (fallback: number) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : Number(v)),
    z.number().min(0).max(1).default(fallback),
  );

/** A list given as a YAML array or as a comma / newline separated string. */
const list = (fallback: string[] = []) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const items = Array.isArray(v) ? v.map(String) : String(v).split(/[,\n]/);
    return items.map((s) => s.trim()).filter(Boolean);
  }, z.array(z.string()).default(fallback));

const str = (fallback = "") =>
  z.preprocess((v) => (v === undefined || v === null ? undefined : String(v)), z.string().default(fallback));

const choice = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : String(v).trim().toLowerCase()),
    z.enum(values).default(fallback as never),
  );

export const GROUP_BY = ["language", "topic", "list", "ai-category", "none"] as const;
export const SORT_BY = ["stars", "name", "starred-at", "pushed-at"] as const;
export const COLUMNS = [
  "index",
  "name",
  "description",
  "author",
  "stars",
  "language",
  "topics",
  "license",
  "pushed",
  "starred",
] as const;
export const BADGES = ["archived", "stale", "new", "fork"] as const;
export const AI_PROVIDERS = [
  "github-models",
  "openai",
  "anthropic",
  "google",
  "mistral",
  "openrouter",
  "custom",
] as const;
export const AI_FEATURES = ["categorize", "describe", "digest"] as const;

const overrideSchema = z.object({
  category: z.string().optional(),
  description: z.string().optional(),
  hide: z.boolean().optional(),
});

const schema = z.object({
  token: str(),
  username: str(),
  output: str("README.md"),
  title: str("Awesome Stars"),
  locale: str("en"),
  description: str(),
  message: str("chore: update starred repositories"),
  branch: str(),
  commit: bool(true),
  "dry-run": bool(false),

  "group-by": choice(GROUP_BY, "language"),
  sort: choice(SORT_BY, "stars"),
  order: choice(["desc", "asc"] as const, "desc"),
  format: choice(["table", "list"] as const, "table"),
  columns: list(["name", "description", "author", "stars"]).pipe(z.array(z.enum(COLUMNS))),
  "star-format": choice(["compact", "exact"] as const, "compact"),
  "collapse-threshold": int(0),
  split: choice(["auto", "always", "never"] as const, "auto"),
  "split-dir": str("stars"),
  "split-threshold": int(500, 10),
  "split-preview": int(5),
  "max-per-group": int(0),
  "min-group-size": int(1, 1),
  "topic-groups": int(40, 1),

  "exclude-archived": bool(false),
  "exclude-forks": bool(false),
  "exclude-own": bool(false),
  "min-stars": int(0),
  include: list(),
  exclude: list(),
  "exclude-topics": list(),
  languages: list(),

  badges: list(["archived", "stale"]).pipe(z.array(z.enum(BADGES))),
  "stale-days": int(730, 1),
  "new-days": int(30, 1),
  "recent-count": int(10),
  stats: bool(true),
  toc: bool(true),
  "back-to-top": bool(true),
  header: str(),
  footer: str(),

  "html-output": str(),
  "json-output": str(),
  "feed-output": str(),
  "feed-size": int(50, 1),

  ai: bool(false),
  "ai-provider": choice(AI_PROVIDERS, "github-models"),
  "ai-model": str(),
  "ai-api-key": str(),
  "ai-base-url": str(),
  "ai-features": list(["categorize", "describe", "digest"]).pipe(z.array(z.enum(AI_FEATURES))),
  "ai-language": str(),
  "ai-categories": list(),
  "ai-batch-size": int(40, 1),
  "ai-max-calls": int(60),
  "ai-min-interval-ms": z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : Number(v)),
    z.number().int().min(0).optional(),
  ),
  "ai-refresh": bool(false),
  "ai-sample-size": int(150, 10),
  "ai-digest-days": int(30, 1),
  "ai-min-coverage": ratio(0.9),

  overrides: z.record(z.string(), overrideSchema).default({}),
  pinned: list(),
});

type Parsed = z.infer<typeof schema>;

export interface Config {
  token: string;
  username: string;
  output: string;
  title: string;
  /** Locale of the fixed texts (headings, legend, site): "en" or "fr". */
  locale: string;
  description: string;
  message: string;
  branch: string;
  commit: boolean;
  dryRun: boolean;
  groupBy: (typeof GROUP_BY)[number];
  sort: (typeof SORT_BY)[number];
  order: "asc" | "desc";
  format: "table" | "list";
  columns: (typeof COLUMNS)[number][];
  starFormat: "compact" | "exact";
  collapseThreshold: number;
  split: "auto" | "always" | "never";
  splitDir: string;
  /** Size in KB above which `split: auto` splits, and that the index must stay under. */
  splitThreshold: number;
  /** Entries of each group kept in the index when split, with a link to the full file. */
  splitPreview: number;
  maxPerGroup: number;
  minGroupSize: number;
  topicGroups: number;
  filters: {
    excludeArchived: boolean;
    excludeForks: boolean;
    excludeOwn: boolean;
    minStars: number;
    include: string[];
    exclude: string[];
    excludeTopics: string[];
    languages: string[];
  };
  badges: (typeof BADGES)[number][];
  staleDays: number;
  newDays: number;
  recentCount: number;
  stats: boolean;
  toc: boolean;
  backToTop: boolean;
  header: string;
  footer: string;
  htmlOutput: string;
  jsonOutput: string;
  feedOutput: string;
  feedSize: number;
  ai: AiConfig;
  overrides: Record<string, z.infer<typeof overrideSchema>>;
  pinned: string[];
}

export interface AiConfig {
  enabled: boolean;
  provider: (typeof AI_PROVIDERS)[number];
  model: string;
  apiKey: string;
  baseUrl: string;
  features: (typeof AI_FEATURES)[number][];
  language: string;
  categories: string[];
  batchSize: number;
  maxCalls: number;
  /** Minimum delay between two calls; GitHub Models' free tier allows about 15 a minute. */
  minIntervalMs: number;
  refresh: boolean;
  sampleSize: number;
  digestDays: number;
  minCoverage: number;
}

function toConfig(p: Parsed): Config {
  const provider = p["ai-provider"];
  return {
    token: p.token,
    username: p.username,
    output: p.output,
    title: p.title,
    locale: p.locale,
    description: p.description,
    message: p.message,
    branch: p.branch,
    commit: p.commit,
    dryRun: p["dry-run"],
    groupBy: p["group-by"],
    sort: p.sort,
    order: p.order,
    format: p.format,
    columns: p.columns,
    starFormat: p["star-format"],
    collapseThreshold: p["collapse-threshold"],
    split: p.split,
    splitDir: p["split-dir"],
    splitThreshold: p["split-threshold"],
    splitPreview: p["split-preview"],
    maxPerGroup: p["max-per-group"],
    minGroupSize: p["min-group-size"],
    topicGroups: p["topic-groups"],
    filters: {
      excludeArchived: p["exclude-archived"],
      excludeForks: p["exclude-forks"],
      excludeOwn: p["exclude-own"],
      minStars: p["min-stars"],
      include: p.include,
      exclude: p.exclude,
      excludeTopics: p["exclude-topics"].map((t) => t.toLowerCase()),
      languages: p.languages.map((l) => l.toLowerCase()),
    },
    badges: p.badges,
    staleDays: p["stale-days"],
    newDays: p["new-days"],
    recentCount: p["recent-count"],
    stats: p.stats,
    toc: p.toc,
    backToTop: p["back-to-top"],
    header: p.header,
    footer: p.footer,
    htmlOutput: p["html-output"],
    jsonOutput: p["json-output"],
    feedOutput: p["feed-output"],
    feedSize: p["feed-size"],
    ai: {
      enabled: p.ai,
      provider,
      model: p["ai-model"],
      apiKey: p["ai-api-key"],
      baseUrl: p["ai-base-url"],
      features: p["ai-features"],
      language: p["ai-language"] || p.locale,
      categories: p["ai-categories"],
      batchSize: p["ai-batch-size"],
      maxCalls: p["ai-max-calls"],
      minIntervalMs: p["ai-min-interval-ms"] ?? (provider === "github-models" ? 4500 : 0),
      refresh: p["ai-refresh"],
      sampleSize: p["ai-sample-size"],
      digestDays: p["ai-digest-days"],
      minCoverage: p["ai-min-coverage"],
    },
    overrides: p.overrides,
    pinned: p.pinned,
  };
}

/** Every option name the Action understands, for reading inputs and rejecting typos. */
export const OPTION_NAMES = Object.keys(schema.shape);

/** Options that only make sense in the config file (objects and lists of objects). */
const FILE_ONLY = new Set(["overrides"]);

/** Inputs set on the Action step: `INPUT_<NAME>` env vars, empty ones left out. */
export function readActionInputs(env: NodeJS.ProcessEnv = process.env): RawOptions {
  const out: RawOptions = {};
  for (const name of OPTION_NAMES) {
    if (FILE_ONLY.has(name)) continue;
    const value = env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
    if (value !== undefined && value.trim() !== "") out[name] = value.trim();
  }
  return out;
}

/** `--name value`, `--name=value` and bare `--flag` (true) / `--no-flag` (false). */
export function parseArgs(argv: string[]): RawOptions {
  const out: RawOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (body.startsWith("no-") && OPTION_NAMES.includes(body.slice(3))) {
      out[body.slice(3)] = "false";
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[body] = next;
      i++;
    } else {
      out[body] = "true";
    }
  }
  return out;
}

/** The YAML config file, or an empty object when it does not exist. */
export function readConfigFile(workspace: string, path = CONFIG_PATH): RawOptions {
  const full = join(workspace, path);
  if (!existsSync(full)) return {};
  const data = parseYaml(readFileSync(full, "utf8"));
  if (data === null || data === undefined) return {};
  if (typeof data !== "object" || Array.isArray(data)) throw new Error(`${path} must be a YAML mapping`);
  return data as RawOptions;
}

/**
 * Validate options merged from lowest to highest precedence (config file, Action inputs, CLI).
 * Unknown keys are rejected so a typo does not silently fall back to a default.
 */
export function resolveConfig(...layers: RawOptions[]): Config {
  const merged: RawOptions = Object.assign({}, ...layers);
  delete merged.config;
  const unknown = Object.keys(merged).filter((k) => !OPTION_NAMES.includes(k));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(", ")}`);
  const result = schema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "options"}: ${i.message}`);
    throw new Error(`Invalid options:\n  ${issues.join("\n  ")}`);
  }
  return toConfig(result.data);
}
