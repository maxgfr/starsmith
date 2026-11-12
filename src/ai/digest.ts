import { languageName } from "llm-connect";
import type { AiConfig } from "../config.js";
import { log } from "../log.js";
import { byStarredDesc } from "../pipeline/sort.js";
import type { State } from "../state.js";
import { truncate } from "../text.js";
import type { Repo } from "../types.js";
import type { AiClient } from "./client.js";
import { repoLine, UNTRUSTED_NOTE } from "./prompt.js";

const DAY = 86_400_000;
const MAX_REPOS = 60;

/** The stars of the digest window, newest first. */
export function digestWindow(repos: Repo[], cfg: AiConfig, today: string): Repo[] {
  const since = Date.parse(today) - cfg.digestDays * DAY;
  return byStarredDesc(repos.filter((r) => Date.parse(r.starredAt) >= since));
}

/** Model text made safe for the README: no headings, links, HTML or runaway length. */
export function cleanDigest(text: string): string {
  const cleaned = text
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)]\([^)]*\)/g, "$1")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncate(cleaned, 1500);
}

/** Whether the stored digest is out of date: newer stars, another language, or a refresh. */
export function digestNeeded(window: Repo[], state: State, cfg: AiConfig): boolean {
  const newest = window[0];
  if (!newest) return false;
  const digest = state.digest;
  return cfg.refresh || !digest || digest.upTo !== newest.starredAt || digest.language !== cfg.language;
}

/** Summarize what was starred lately. Only called when {@link digestNeeded}. */
export async function writeDigest(window: Repo[], state: State, ai: AiClient, cfg: AiConfig): Promise<void> {
  const newest = window[0];
  if (!newest) return;
  const shown = window.slice(0, MAX_REPOS);
  const text = await ai.text({
    system: `You write the short editorial intro of a developer's awesome list of GitHub stars. ${UNTRUSTED_NOTE}`,
    prompt: [
      `Repositories starred in the last ${cfg.digestDays} days (${window.length}, newest first):`,
      "",
      ...shown.map((r, i) => repoLine(r, i + 1, 120)),
      "",
      `In ${languageName(cfg.language)}, write 2 short paragraphs (90 words at most in total) on`,
      "the themes and trends in these stars, citing a few repositories by name. Bold 2 to 4 key",
      "themes with **. No heading, no list, no links, no emoji, no preamble.",
    ].join("\n"),
  });
  const cleaned = cleanDigest(text);
  if (!cleaned) {
    log.warn("The model returned an empty digest; keeping the previous one");
    return;
  }
  state.digest = { text: cleaned, upTo: newest.starredAt, language: cfg.language };
  log.info("Wrote the digest");
}
