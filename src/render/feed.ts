import { TOOL_NAME, TOOL_URL } from "../constants.js";
import { format, type Messages } from "../i18n/index.js";
import type { Entry } from "../types.js";

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An Atom feed of the latest stars. Its `updated` is the newest star, not the run time. */
export function renderFeed(
  recent: Entry[],
  options: { username: string; siteUrl: string; t: Messages },
): string {
  const { username, siteUrl, t } = options;
  const title = format(t.feedTitle, { user: username });
  const updated = recent[0]?.starredAt ?? "1970-01-01T00:00:00Z";
  const entries = recent.map((e) => {
    const summary = [e.displayDescription, e.language, e.topics.slice(0, 5).join(", ")]
      .filter(Boolean)
      .join(" · ");
    return [
      "  <entry>",
      `    <title>${xml(e.nameWithOwner)}</title>`,
      `    <link href="${xml(e.url)}"/>`,
      `    <id>${xml(e.url)}</id>`,
      `    <updated>${e.starredAt}</updated>`,
      `    <author><name>${xml(e.owner)}</name></author>`,
      ...(summary ? [`    <summary>${xml(summary)}</summary>`] : []),
      ...e.topics.slice(0, 5).map((topic) => `    <category term="${xml(topic)}"/>`),
      "  </entry>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xml(title)}</title>`,
    `  <link href="${xml(siteUrl)}"/>`,
    `  <id>${xml(siteUrl)}</id>`,
    `  <updated>${updated}</updated>`,
    `  <generator uri="${TOOL_URL}">${TOOL_NAME}</generator>`,
    ...entries,
    "</feed>",
    "",
  ].join("\n");
}
