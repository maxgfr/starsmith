/** Placeholders for the "Updated" date: content is hashed with them, then they are filled in. */
export const UPDATED = "%%UPDATED%%";
export const UPDATED_BADGE = "%%UPDATED_BADGE%%";

/** 999, 1.2k, 12.3k, 123k, 1.2M: coarse enough that star counts rarely change the file. */
export function compactNumber(n: number): string {
  const fmt = (value: number, suffix: string) => {
    const digits = value < 100 ? 1 : 0;
    return `${Number(value.toFixed(digits))}${suffix}`;
  };
  if (n < 1000) return String(n);
  if (n < 999_950) return fmt(n / 1000, "k");
  return fmt(n / 1_000_000, "M");
}

export function formatStars(n: number, style: "compact" | "exact"): string {
  return style === "compact" ? compactNumber(n) : String(n);
}

/** Text safe inside a Markdown table cell or list item. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A shields.io static badge segment: `-` and `_` are doubled, spaces become `_`. */
export function shieldsText(text: string): string {
  return encodeURIComponent(text.replace(/-/g, "--").replace(/_/g, "__").replace(/ /g, "_"));
}

/**
 * The anchors GitHub gives headings: lowercase, punctuation and emoji dropped, spaces turned
 * into hyphens, and `-1`, `-2`… appended to repeats (so "C", "C#", "C++" are c, c-1, c-2).
 */
export class Slugger {
  private occurrences = new Map<string, number>();

  /** Same algorithm as github-slugger, which GitHub uses for heading anchors. */
  slug(heading: string): string {
    const original = heading
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    let slug = original;
    while (this.occurrences.has(slug)) {
      const n = (this.occurrences.get(original) ?? 0) + 1;
      this.occurrences.set(original, n);
      slug = `${original}-${n}`;
    }
    this.occurrences.set(slug, 0);
    return slug;
  }
}

/** A file name for a group: ASCII, lowercase, `+` and `#` spelled out, unique within `taken`. */
export function fileSlug(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/\+/g, " plus ")
      .replace(/#/g, " sharp ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group";
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  taken.add(slug);
  return slug;
}

export function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}
