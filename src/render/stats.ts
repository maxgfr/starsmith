import { format, type Messages } from "../i18n/index.js";
import type { Repo } from "../types.js";
import { day } from "./format.js";

const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;

/**
 * Totals and two Mermaid charts GitHub renders natively. Everything is derived from the stars
 * themselves (not their star counts), so the section only changes when stars are added or removed.
 */
export function renderStats(repos: Repo[], t: Messages, topN = 10): string {
  if (!repos.length) return "";
  const languages = new Map<string, number>();
  const years = new Map<string, number>();
  let archived = 0;
  let since = repos[0]?.starredAt ?? "";
  for (const r of repos) {
    if (r.language) languages.set(r.language, (languages.get(r.language) ?? 0) + 1);
    const year = r.starredAt.slice(0, 4);
    years.set(year, (years.get(year) ?? 0) + 1);
    if (r.archived) archived++;
    if (r.starredAt < since) since = r.starredAt;
  }

  const ranked = [...languages.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, topN);
  const rest = repos.length - top.reduce((sum, [, n]) => sum + n, 0);
  const pie = [
    "```mermaid",
    `pie showData title ${t.topLanguages}`,
    ...top.map(([name, n]) => `    ${quote(name)} : ${n}`),
    ...(rest > 0 ? [`    ${quote(t.otherLanguages)} : ${rest}`] : []),
    "```",
  ];

  const yearKeys = [...years.keys()].sort();
  const bar = [
    "```mermaid",
    "xychart-beta",
    `    title ${quote(t.starsPerYear)}`,
    `    x-axis [${yearKeys.join(", ")}]`,
    `    bar [${yearKeys.map((y) => years.get(y)).join(", ")}]`,
    "```",
  ];

  const summary = format(t.statsSummary, {
    total: repos.length,
    languages: languages.size,
    archived,
    since: day(since),
  });
  return [`## ${t.stats}`, summary, pie.join("\n"), bar.join("\n")].join("\n\n");
}
