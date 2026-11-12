import { log } from "../log.js";
import type { Repo, StarList, StarsData } from "../types.js";
import type { GraphqlFn, RestFn } from "./client.js";

const LISTS_QUERY = `
  query($login: String!, $cursor: String) {
    user(login: $login) {
      lists(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id name description }
      }
    }
  }
`;

const LIST_ITEMS_QUERY = `
  query($id: ID!, $cursor: String) {
    node(id: $id) {
      ... on UserList {
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { ... on Repository { id } }
        }
      }
    }
  }
`;

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/** A repository as the REST API returns it, with the fields we use. */
export interface RestRepo {
  node_id: string;
  full_name: string;
  name: string;
  owner: { login: string };
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  license: { spdx_id: string | null } | null;
  archived: boolean;
  fork: boolean;
  pushed_at: string | null;
  created_at: string;
}

interface RestStar {
  starred_at: string;
  repo: RestRepo;
}

function clean(text: string | null): string | null {
  const value = text?.replace(/\s+/g, " ").trim();
  return value ? value : null;
}

export function normalizeRepo(raw: RestRepo, starredAt: string): Repo {
  const spdx = raw.license?.spdx_id;
  return {
    id: raw.node_id,
    nameWithOwner: raw.full_name,
    name: raw.name,
    owner: raw.owner.login,
    url: raw.html_url,
    description: clean(raw.description),
    homepageUrl: clean(raw.homepage),
    language: raw.language ?? null,
    topics: raw.topics ?? [],
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    license: spdx && spdx !== "NOASSERTION" ? spdx : null,
    archived: raw.archived,
    fork: raw.fork,
    pushedAt: raw.pushed_at,
    createdAt: raw.created_at,
    starredAt,
  };
}

/** The last page number in a Link header, or 1 when there is no next page. */
export function lastPage(link: string | null): number {
  const match = link?.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return match ? Number(match[1]) : 1;
}

const STAR_ACCEPT = "application/vnd.github.star+json";
const PER_PAGE = 100;
const CONCURRENCY = 6;

/**
 * Every star, newest first. The REST API numbers its pages, so after the first one the others
 * are fetched in parallel: a 5,000-star history takes seconds instead of minutes of cursors.
 */
export async function fetchStarredRepos(rest: RestFn, login: string): Promise<Repo[]> {
  const path = (page: number) =>
    `/users/${encodeURIComponent(login)}/starred?per_page=${PER_PAGE}&page=${page}&sort=created&direction=desc`;
  const first = await rest<RestStar[]>(path(1), STAR_ACCEPT);
  const last = lastPage(first.link);
  const pages: RestStar[][] = [first.data];
  let next = 2;
  let done = 1;
  const worker = async () => {
    while (next <= last) {
      const page = next++;
      pages[page - 1] = (await rest<RestStar[]>(path(page), STAR_ACCEPT)).data;
      if (++done % 10 === 0) log.info(`Fetched ${done}/${last} pages of stars`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, last - 1) }, worker));

  // A star added mid-fetch shifts the pages: drop the duplicate it creates.
  const seen = new Set<string>();
  const repos: Repo[] = [];
  for (const star of pages.flat()) {
    if (!star?.repo || seen.has(star.repo.node_id)) continue;
    seen.add(star.repo.node_id);
    repos.push(normalizeRepo(star.repo, star.starred_at));
  }
  log.info(`Fetched ${repos.length} starred repositories`);
  return repos;
}

interface ListsPage {
  user: { lists: { pageInfo: PageInfo; nodes: { id: string; name: string; description: string | null }[] } };
}

interface ListItemsPage {
  node: { items: { pageInfo: PageInfo; nodes: ({ id?: string } | null)[] } } | null;
}

export async function fetchStarLists(gql: GraphqlFn, login: string): Promise<StarList[]> {
  const lists: StarList[] = [];
  let cursor: string | null = null;
  do {
    const page: ListsPage = await gql<ListsPage>(LISTS_QUERY, { login, cursor });
    for (const node of page.user.lists.nodes) {
      const repoIds: string[] = [];
      let itemCursor: string | null = null;
      do {
        const items: ListItemsPage = await gql<ListItemsPage>(LIST_ITEMS_QUERY, {
          id: node.id,
          cursor: itemCursor,
        });
        if (!items.node) break;
        for (const item of items.node.items.nodes) if (item?.id) repoIds.push(item.id);
        itemCursor = items.node.items.pageInfo.hasNextPage ? items.node.items.pageInfo.endCursor : null;
      } while (itemCursor);
      lists.push({ name: node.name, description: clean(node.description), repoIds });
    }
    cursor = page.user.lists.pageInfo.hasNextPage ? page.user.lists.pageInfo.endCursor : null;
  } while (cursor);
  log.info(`Fetched ${lists.length} star lists`);
  return lists;
}

export async function fetchStars(
  rest: RestFn,
  gql: GraphqlFn,
  login: string,
  withLists: boolean,
): Promise<StarsData> {
  const repos = await fetchStarredRepos(rest, login);
  const lists = withLists ? await fetchStarLists(gql, login) : [];
  return { repos, lists };
}
