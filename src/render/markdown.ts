import { posix } from "node:path";
import type { Config } from "../config.js";
import { OTHERS, TOOL_NAME, TOOL_URL } from "../constants.js";
import { format, type Messages } from "../i18n/index.js";
import { BADGE_LABELS } from "../pipeline/badges.js";
import type { Entry, Group } from "../types.js";
import {
  day,
  escapeMarkdown,
  fileSlug,
  formatStars,
  Slugger,
  shieldsText,
  UPDATED,
  UPDATED_BADGE,
} from "./format.js";
import { renderStats } from "./stats.js";

export interface RenderModel {
  config: Config;
  t: Messages;
  username: string;
  entries: Entry[];
  groups: Group[];
  pinned: Entry[];
  recent: Entry[];
  digest: { text: string; count: number; days: number } | null;
}

export interface OutputFile {
  path: string;
  contents: string;
}

export function groupLabel(name: string, t: Messages): string {
  if (name === OTHERS) return t.others;
  if (name === "All") return t.all;
  return name;
}

function badgeMarks(entry: Entry): string {
  return entry.badges.map((b) => BADGE_LABELS[b as keyof typeof BADGE_LABELS] ?? "").join("");
}

function cell(entry: Entry, column: Config["columns"][number], index: number, config: Config): string {
  switch (column) {
    case "index":
      return String(index + 1);
    case "name": {
      const marks = badgeMarks(entry);
      return `[${escapeMarkdown(entry.name)}](${entry.url})${marks ? ` ${marks}` : ""}`;
    }
    case "description":
      return entry.displayDescription ? escapeMarkdown(entry.displayDescription) : "";
    case "author":
      return escapeMarkdown(entry.owner);
    case "stars":
      return formatStars(entry.stars, config.starFormat);
    case "language":
      return escapeMarkdown(entry.language ?? "");
    case "topics":
      return entry.topics
        .slice(0, 5)
        .map((t) => `\`${t}\``)
        .join(" ");
    case "license":
      return escapeMarkdown(entry.license ?? "");
    case "pushed":
      return day(entry.pushedAt);
    case "starred":
      return day(entry.starredAt);
  }
}

const NUMERIC = new Set(["index", "stars"]);

export function renderTable(entries: Entry[], config: Config, t: Messages): string {
  const cols = config.columns;
  const head = `| ${cols.map((c) => t.columns[c]).join(" | ")} |`;
  const rule = `|${cols.map((c) => (NUMERIC.has(c) ? "---:" : "---")).join("|")}|`;
  const rows = entries.map((e, i) => `| ${cols.map((c) => cell(e, c, i, config)).join(" | ")} |`);
  return [head, rule, ...rows].join("\n");
}

export function renderList(entries: Entry[], config: Config): string {
  return entries
    .map((e, i) => {
      const parts = config.columns.filter((c) => c !== "name" && c !== "description" && c !== "index");
      const meta = parts
        .map((c) => {
          const value = cell(e, c, i, config);
          if (!value) return "";
          if (c === "stars") return `⭐ ${value}`;
          if (c === "author") return `by ${value}`;
          return value;
        })
        .filter(Boolean);
      const desc =
        config.columns.includes("description") && e.displayDescription
          ? ` — ${escapeMarkdown(e.displayDescription)}`
          : "";
      const prefix = config.columns.includes("index") ? `${i + 1}. ` : "- ";
      return `${prefix}${cell(e, "name", i, config)}${desc}${meta.length ? ` · ${meta.join(" · ")}` : ""}`;
    })
    .join("\n");
}

function renderEntries(group: Group, config: Config, t: Messages): string {
  const body =
    config.format === "table" ? renderTable(group.entries, config, t) : renderList(group.entries, config);
  const more = group.hidden ? `\n\n_${format(t.andMore, { count: group.hidden })}_` : "";
  if (config.collapseThreshold > 0 && group.entries.length > config.collapseThreshold) {
    const summary = format(t.showRepos, { count: group.entries.length });
    return `<details>\n<summary>${summary}</summary>\n\n${body}${more}\n\n</details>`;
  }
  return `${body}${more}`;
}

function header(model: RenderModel): string {
  const { config, t, entries } = model;
  if (config.header.trim()) return config.header.trim();
  const description =
    config.description.trim() || format(t.defaultDescription, { tool: `[${TOOL_NAME}](${TOOL_URL})` });
  const badges = [
    `![${t.total}](https://img.shields.io/badge/${shieldsText(t.total)}-${entries.length}-green.svg)`,
    `![${t.updated}](https://img.shields.io/badge/${shieldsText(t.updated)}-${UPDATED_BADGE}-blue.svg)`,
  ].join(" ");
  return `# ${config.title}\n\n> ${description}\n\n${badges}`;
}

function legend(model: RenderModel): string {
  const { config, t } = model;
  const used = new Set(model.entries.flatMap((e) => e.badges));
  const items = config.badges
    .filter((b) => used.has(b))
    .map((b) => {
      const days = b === "stale" ? config.staleDays : config.newDays;
      return `${BADGE_LABELS[b]} ${format(t.badges[b], { days })}`;
    });
  return items.length ? `**${t.legend}:** ${items.join(" · ")}` : "";
}

function footer(model: RenderModel): string {
  const custom = model.config.footer.trim();
  const credit = `<sub>${format(model.t.generatedBy, { tool: `[${TOOL_NAME}](${TOOL_URL})` })} · ${UPDATED}</sub>`;
  return [custom, credit].filter(Boolean).join("\n\n");
}

function recentSection(model: RenderModel): string {
  if (!model.recent.length) return "";
  const lines = model.recent.map((e) => {
    const desc = e.displayDescription ? ` — ${escapeMarkdown(e.displayDescription)}` : "";
    return `- \`${day(e.starredAt)}\` [${escapeMarkdown(e.nameWithOwner)}](${e.url})${desc}`;
  });
  return `## ${model.t.recentlyStarred}\n\n${lines.join("\n")}`;
}

function digestSection(model: RenderModel): string {
  if (!model.digest) return "";
  const note = format(model.t.digestNote, { count: model.digest.count, days: model.digest.days });
  return `## ${model.t.digest}\n\n${model.digest.text}\n\n<sub>${note}</sub>`;
}

function pinnedSection(model: RenderModel): string {
  if (!model.pinned.length) return "";
  const group: Group = { name: model.t.pinned, entries: model.pinned, hidden: 0 };
  const body =
    model.config.format === "table"
      ? renderTable(group.entries, model.config, model.t)
      : renderList(group.entries, model.config);
  return `## ${model.t.pinned}\n\n${body}`;
}

/** The sections before the groups, with the headings they add (they take anchors first). */
function intro(model: RenderModel, slugger: Slugger): string[] {
  const { config, t } = model;
  const parts: string[] = [];
  const add = (text: string, heading?: string) => {
    if (!text) return;
    if (heading) slugger.slug(heading);
    parts.push(text);
  };
  const head = header(model);
  for (const match of head.matchAll(/^#{1,6} (.+)$/gm)) slugger.slug(match[1] as string);
  parts.push(head);
  add(digestSection(model), model.digest ? t.digest : undefined);
  add(pinnedSection(model), model.pinned.length ? t.pinned : undefined);
  add(recentSection(model), model.recent.length ? t.recentlyStarred : undefined);
  if (config.stats) add(renderStats(model.entries, t), t.stats);
  return parts;
}

function joinBlocks(blocks: string[]): string {
  return `${blocks.filter(Boolean).join("\n\n")}\n`;
}

/** One file with every group. */
export function renderSingle(model: RenderModel): string {
  const { config, t, groups } = model;
  const slugger = new Slugger();
  const blocks = intro(model, slugger);
  const contentsSlug = config.toc && groups.length > 1 ? slugger.slug(t.contents) : null;
  const labels = groups.map((g) => groupLabel(g.name, t));
  const slugs = labels.map((label) => slugger.slug(label));
  if (contentsSlug) {
    const toc = groups.map((g, i) => `- [${labels[i]} (${g.entries.length + g.hidden})](#${slugs[i]})`);
    blocks.push(`## ${t.contents}\n\n${toc.join("\n")}`);
  }
  groups.forEach((group, i) => {
    const back = config.backToTop && contentsSlug ? `\n\n**[${t.backToTop}](#${contentsSlug})**` : "";
    blocks.push(`## ${labels[i]}\n\n${renderEntries(group, config, t)}${back}`);
  });
  blocks.push(legend(model), footer(model));
  return joinBlocks(blocks);
}

/**
 * An index plus one file per group, for lists too big for a single page. The index keeps the
 * first `preview` entries of each group with a link to its full file.
 */
export function renderSplit(model: RenderModel, preview = model.config.splitPreview): OutputFile[] {
  const { config, t, groups } = model;
  const outDir = posix.dirname(config.output);
  const groupDir = posix.join(outDir, config.splitDir);
  const backLink = posix.relative(groupDir, config.output);
  const taken = new Set<string>();
  const files: OutputFile[] = [];
  const toc: string[] = [];
  const sections: string[] = [];
  const flat = { ...config, collapseThreshold: 0 };

  for (const group of groups) {
    const label = groupLabel(group.name, t);
    const name = `${fileSlug(label, taken)}.md`;
    const link = posix.join(config.splitDir, name);
    const total = group.entries.length + group.hidden;
    toc.push(`- [${label} (${total})](${link})`);
    if (preview > 0) {
      const shown: Group = { name: group.name, entries: group.entries.slice(0, preview), hidden: 0 };
      sections.push(
        `## ${label}\n\n${renderEntries(shown, flat, t)}\n\n**[${format(t.seeAll, { count: total })}](${link})**`,
      );
    }
    const body = joinBlocks([
      `# ${label}`,
      `[${format(t.backTo, { title: config.title })}](${backLink})`,
      renderEntries(group, flat, t),
      legend({ ...model, entries: group.entries }),
    ]);
    files.push({ path: posix.join(groupDir, name), contents: body });
  }

  const slugger = new Slugger();
  const blocks = intro(model, slugger);
  blocks.push(`## ${t.contents}\n\n${toc.join("\n")}`, ...sections, legend(model), footer(model));
  const index = joinBlocks(blocks);
  // Previews must not push the index back over the limit the split exists to respect.
  if (preview > 0 && Buffer.byteLength(index) > config.splitThreshold * 1000) return renderSplit(model, 0);
  return [{ path: config.output, contents: index }, ...files];
}

/**
 * The Markdown outputs: one file, or an index plus a file per group when one file would pass
 * `split-threshold` (GitHub stops rendering very large Markdown files).
 */
export function renderMarkdown(model: RenderModel): OutputFile[] {
  const { split, splitThreshold } = model.config;
  if (split === "always") return renderSplit(model);
  const single = renderSingle(model);
  if (split === "auto" && Buffer.byteLength(single) > splitThreshold * 1000 && model.groups.length > 1)
    return renderSplit(model);
  return [{ path: model.config.output, contents: single }];
}
