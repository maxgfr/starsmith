import { languageName } from "llm-connect";
import { z } from "zod";
import type { AiConfig } from "../config.js";
import { log } from "../log.js";
import { hash, type State } from "../state.js";
import { truncate } from "../text.js";
import type { Repo } from "../types.js";
import { AiCallError, type AiClient, BudgetExhausted } from "./client.js";
import { chunks, repoLine, UNTRUSTED_NOTE } from "./prompt.js";

const MAX_LENGTH = 140;

function describeHash(repo: Repo, language: string): string {
  return hash(language, repo.description, repo.topics.slice(0, 6));
}

export function cleanDescription(text: string): string | null {
  const value = text
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (!value) return null;
  return value.length > MAX_LENGTH ? `${truncate(value, MAX_LENGTH - 1).trimEnd()}…` : value.toWellFormed();
}

/** The AI description stored for a repository, if it was written from its current description. */
export function describedOf(repo: Repo, state: State, language: string): string | null {
  const annotation = state.repos[repo.id];
  if (!annotation?.description || annotation.dh !== describeHash(repo, language)) return null;
  return annotation.description;
}

/**
 * Rewrite descriptions as short, consistent one-liners in the configured language. Repositories
 * without a description or topics are left alone: there is nothing to summarize.
 */
export async function describe(repos: Repo[], state: State, ai: AiClient, cfg: AiConfig): Promise<void> {
  const pending = repos
    .filter(
      (r) => (r.description || r.topics.length) && state.repos[r.id]?.dh !== describeHash(r, cfg.language),
    )
    .sort((a, b) => b.starredAt.localeCompare(a.starredAt));
  if (!pending.length) return;
  log.info(`Rewriting ${pending.length} descriptions (${ai.remaining()} AI calls left)`);
  const language = languageName(cfg.language);
  const schema = z.object({ items: z.array(z.object({ n: z.number().int(), description: z.string() })) });
  let done = 0;

  for (const batch of chunks(pending, cfg.batchSize)) {
    try {
      const result = await ai.json({
        schema,
        system: `You write the one-line descriptions of an awesome list. ${UNTRUSTED_NOTE}`,
        prompt: [
          ...batch.map((r, i) => repoLine(r, i + 1, 200)),
          "",
          `For each numbered repository, return its number as n and a description in ${language}:`,
          "one sentence, at most 100 characters, saying what it is and what it is for. Plain and",
          "factual: no marketing, no emoji, no Markdown, do not start with the project name, keep",
          "technical names as they are. If there is no description, infer it only from the topics.",
        ].join("\n"),
      });
      for (const item of result.items) {
        const repo = batch[item.n - 1];
        const description = cleanDescription(item.description);
        if (!repo || !description) continue;
        state.repos[repo.id] = { ...state.repos[repo.id], dh: describeHash(repo, cfg.language), description };
        done++;
      }
    } catch (error) {
      if (error instanceof BudgetExhausted) {
        log.info(`Stopping descriptions: ${error.message}`);
        break;
      }
      if (
        error instanceof AiCallError &&
        !error.detail.retryable &&
        error.detail.code !== "invalid-request"
      ) {
        log.warn(`Stopping descriptions: ${error.message}`);
        break;
      }
      log.warn(`Skipping a batch: ${(error as Error).message}`);
    }
  }
  log.info(`Rewrote ${done} descriptions`);
}
