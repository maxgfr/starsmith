/** A starred repository, as fetched from GitHub and normalized. */
export interface Repo {
  /** GraphQL node id: stable across renames and transfers. */
  id: string;
  nameWithOwner: string;
  name: string;
  owner: string;
  url: string;
  description: string | null;
  homepageUrl: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  /** SPDX id, or null when GitHub found none (or "NOASSERTION"). */
  license: string | null;
  archived: boolean;
  fork: boolean;
  pushedAt: string | null;
  createdAt: string;
  starredAt: string;
}

/** A GitHub star list ("Lists" on the stars page) and the repository ids it holds. */
export interface StarList {
  name: string;
  description: string | null;
  repoIds: string[];
}

export interface StarsData {
  repos: Repo[];
  lists: StarList[];
}

/** A repository ready to render: the fetched data plus everything the pipeline derived. */
export interface Entry extends Repo {
  /** Description to show: manual override, then AI rewrite, then GitHub's. */
  displayDescription: string | null;
  /** AI or manual category, when there is one. */
  category: string | null;
  badges: string[];
}

export interface Group {
  name: string;
  entries: Entry[];
  /** Entries left out by `max-per-group`. */
  hidden: number;
}
