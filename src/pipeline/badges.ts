import type { Config } from "../config.js";
import type { Repo } from "../types.js";

const DAY = 86_400_000;

export const BADGE_LABELS = {
  archived: "🗄️",
  stale: "💤",
  new: "🆕",
  fork: "🍴",
} as const;

export const BADGE_LEGEND = {
  archived: "archived",
  stale: "no push for a long time",
  new: "starred recently",
  fork: "fork",
} as const;

/**
 * The badges a repository earns. "Now" is the day, not the instant, so badges do not flicker
 * between two runs of the same day.
 */
export function badgesFor(repo: Repo, config: Config, today: string): string[] {
  const now = Date.parse(today);
  const out: string[] = [];
  for (const badge of config.badges) {
    if (badge === "archived" && repo.archived) out.push(badge);
    if (badge === "fork" && repo.fork) out.push(badge);
    if (badge === "stale" && !repo.archived && repo.pushedAt) {
      if (now - Date.parse(repo.pushedAt) > config.staleDays * DAY) out.push(badge);
    }
    if (badge === "new" && now - Date.parse(repo.starredAt) <= config.newDays * DAY) out.push(badge);
  }
  return out;
}
