import type { Config } from "../config.js";
import { OTHERS } from "../constants.js";
import type { Entry, Group, StarList } from "../types.js";
import { sortRepos } from "./sort.js";

export type GroupMode = Config["groupBy"];

function topicKeys(entries: Entry[], limit: number, minSize: number): (e: Entry) => string[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const t of new Set(e.topics)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [...counts.entries()]
    .filter(([, n]) => n >= minSize)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
  const rank = new Map(top.map(([t], i) => [t, i]));
  // Each repository goes under its most common topic, so it is listed once.
  return (e) => {
    let best: string | null = null;
    for (const t of e.topics) {
      const r = rank.get(t);
      if (r !== undefined && (best === null || r < (rank.get(best) as number))) best = t;
    }
    return [best ?? OTHERS];
  };
}

/** Group, sort and cap the entries. Groups come in name order, with "Others" last. */
export function groupEntries(
  entries: Entry[],
  mode: GroupMode,
  config: Config,
  lists: StarList[] = [],
): Group[] {
  // A category set by hand in the config wins over the language or topic.
  const manual = (e: Entry) => config.overrides[e.nameWithOwner]?.category;
  let keysOf: (e: Entry) => string[];
  switch (mode) {
    case "language":
      keysOf = (e) => [manual(e) ?? e.language ?? OTHERS];
      break;
    case "ai-category":
      keysOf = (e) => [e.category ?? OTHERS];
      break;
    case "topic": {
      const topic = topicKeys(entries, config.topicGroups, config.minGroupSize);
      keysOf = (e) => {
        const m = manual(e);
        return m ? [m] : topic(e);
      };
      break;
    }
    case "list": {
      const listsOf = new Map<string, string[]>();
      for (const list of lists)
        for (const id of list.repoIds) listsOf.set(id, [...(listsOf.get(id) ?? []), list.name]);
      keysOf = (e) => listsOf.get(e.id) ?? [OTHERS];
      break;
    }
    case "none":
      keysOf = () => ["All"];
      break;
  }

  const buckets = new Map<string, Entry[]>();
  for (const e of entries) {
    for (const key of keysOf(e)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(e);
      else buckets.set(key, [e]);
    }
  }

  if (mode !== "none" && mode !== "list" && config.minGroupSize > 1) {
    for (const [key, bucket] of buckets) {
      if (key === OTHERS || bucket.length >= config.minGroupSize) continue;
      buckets.delete(key);
      buckets.set(OTHERS, [...(buckets.get(OTHERS) ?? []), ...bucket]);
    }
  }

  const names = [...buckets.keys()].sort((a, b) => {
    if (a === OTHERS) return 1;
    if (b === OTHERS) return -1;
    return a.toLowerCase().localeCompare(b.toLowerCase(), "en") || a.localeCompare(b);
  });

  return names.map((name) => {
    const sorted = sortRepos(buckets.get(name) as Entry[], config.sort, config.order);
    const cap = config.maxPerGroup;
    return {
      name,
      entries: cap > 0 ? sorted.slice(0, cap) : sorted,
      hidden: cap > 0 ? Math.max(0, sorted.length - cap) : 0,
    };
  });
}
