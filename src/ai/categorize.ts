import { languageName } from "llm-connect";
import { z } from "zod";
import type { AiConfig } from "../config.js";
import { OTHERS } from "../constants.js";
import { log } from "../log.js";
import { hash, type State, type Taxonomy } from "../state.js";
import { truncate } from "../text.js";
import type { Repo } from "../types.js";
import { AiCallError, type AiClient, BudgetExhausted } from "./client.js";
import { chunks, repoLine, UNTRUSTED_NOTE } from "./prompt.js";

const OTHER_LABEL = "Other";

function cleanCategories(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = truncate(
      raw
        .replace(/\s+/g, " ")
        .replace(/[*_`#|[\]]/g, "")
        .trim(),
      40,
    );
    const key = name.toLowerCase();
    if (!name || seen.has(key) || /^(other|others|misc|miscellaneous)$/i.test(name)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 40);
}

/** A deterministic, spread-out sample: ordered by a hash of the id rather than by date or stars. */
export function sampleRepos(repos: Repo[], size: number): Repo[] {
  return [...repos].sort((a, b) => hash(a.id).localeCompare(hash(b.id))).slice(0, size);
}

async function deriveTaxonomy(repos: Repo[], ai: AiClient, cfg: AiConfig): Promise<string[]> {
  const sample = sampleRepos(repos, cfg.sampleSize);
  const language = languageName(cfg.language);
  const result = await ai.json({
    schema: z.object({ categories: z.array(z.string()).min(5).max(40) }),
    system: [
      "You organize a developer's GitHub stars into a browsable awesome list.",
      "Propose the categories of that list.",
      UNTRUSTED_NOTE,
    ].join(" "),
    prompt: [
      `Here is a sample of ${sample.length} of their ${repos.length} starred repositories:`,
      "",
      ...sample.map((r, i) => repoLine(r, i + 1, 80)),
      "",
      `Propose 12 to 30 categories that together cover all of their stars. Names in ${language},`,
      "1 to 4 words, Title Case, specific and mutually exclusive (for example: Web Frameworks,",
      "CLI Tools, Machine Learning, Databases, DevOps & Infrastructure). No emoji, no catch-all",
      '"Other" category: one is added automatically.',
    ].join("\n"),
  });
  return cleanCategories(result.categories);
}

/** Use the configured taxonomy, the stored one, or ask the model for one. */
async function resolveTaxonomy(
  repos: Repo[],
  state: State,
  ai: AiClient,
  cfg: AiConfig,
): Promise<Taxonomy | null> {
  if (cfg.categories.length) {
    return { categories: cleanCategories(cfg.categories), source: "config" };
  }
  if (state.taxonomy?.source === "ai" && !cfg.refresh) return state.taxonomy;
  log.info("Deriving categories from a sample of the stars");
  const categories = await deriveTaxonomy(repos, ai, cfg);
  if (categories.length < 3) {
    log.warn(`The model proposed too few categories (${categories.join(", ")}); keeping the previous ones`);
    return state.taxonomy;
  }
  log.info(`Categories: ${categories.join(", ")}`);
  return { categories, source: "ai" };
}

function categoryHash(repo: Repo, taxonomyKey: string): string {
  return hash(taxonomyKey, repo.nameWithOwner, repo.description, repo.topics, repo.language);
}

/** Share of repositories with a category valid for the current taxonomy. */
export function categoryCoverage(repos: Repo[], state: State): number {
  if (!repos.length || !state.taxonomy) return 0;
  const key = hash(state.taxonomy.categories);
  const done = repos.filter((r) => state.repos[r.id]?.ch === categoryHash(r, key)).length;
  return done / repos.length;
}

/** The category stored for a repository, if still valid ("Other" maps to the Others group). */
export function categoryOf(repo: Repo, state: State): string | null {
  if (!state.taxonomy) return null;
  const annotation = state.repos[repo.id];
  if (!annotation?.category || annotation.ch !== categoryHash(repo, hash(state.taxonomy.categories)))
    return null;
  return annotation.category === OTHER_LABEL ? OTHERS : annotation.category;
}

/**
 * Classify the repositories that have no valid category yet, newest stars first, in batches.
 * Stops quietly when the budget runs out: the next run picks up where this one stopped.
 */
export async function categorize(repos: Repo[], state: State, ai: AiClient, cfg: AiConfig): Promise<void> {
  const taxonomy = await resolveTaxonomy(repos, state, ai, cfg);
  if (!taxonomy) return;
  state.taxonomy = taxonomy;
  const key = hash(taxonomy.categories);
  const pending = repos
    .filter((r) => state.repos[r.id]?.ch !== categoryHash(r, key))
    .sort((a, b) => b.starredAt.localeCompare(a.starredAt));
  if (!pending.length) return;
  log.info(`Categorizing ${pending.length} repositories (${ai.remaining()} AI calls left)`);

  const allowed = [...taxonomy.categories, OTHER_LABEL];
  const schema = z.object({
    items: z.array(z.object({ n: z.number().int(), category: z.string() })),
  });
  const byLower = new Map(allowed.map((c) => [c.toLowerCase(), c]));
  let done = 0;

  for (const batch of chunks(pending, cfg.batchSize)) {
    try {
      const result = await ai.json({
        schema,
        system: `You sort GitHub repositories into categories. ${UNTRUSTED_NOTE}`,
        prompt: [
          `Categories: ${allowed.join(" | ")}`,
          "",
          ...batch.map((r, i) => repoLine(r, i + 1)),
          "",
          `For each numbered repository, return its number as n and the single best category,`,
          `copied exactly from the list. Use "${OTHER_LABEL}" only when none fits.`,
        ].join("\n"),
      });
      for (const item of result.items) {
        const repo = batch[item.n - 1];
        const category = byLower.get(item.category.trim().toLowerCase());
        if (!repo || !category) continue;
        state.repos[repo.id] = { ...state.repos[repo.id], ch: categoryHash(repo, key), category };
        done++;
      }
    } catch (error) {
      if (error instanceof BudgetExhausted) {
        log.info(`Stopping categorization: ${error.message}`);
        break;
      }
      if (
        error instanceof AiCallError &&
        !error.detail.retryable &&
        error.detail.code !== "invalid-request"
      ) {
        log.warn(`Stopping categorization: ${error.message}`);
        break;
      }
      log.warn(`Skipping a batch: ${(error as Error).message}`);
    }
  }
  log.info(`Categorized ${done} repositories`);
}
