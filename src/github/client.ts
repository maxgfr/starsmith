import { graphql } from "@octokit/graphql";
import { TOOL_NAME } from "../constants.js";
import { log } from "../log.js";

export type GraphqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

export interface RestResponse<T> {
  data: T;
  /** The Link header, for pagination. */
  link: string | null;
}

export type RestFn = <T>(path: string, accept?: string) => Promise<RestResponse<T>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (status === undefined) return !(error as { errors?: unknown }).errors; // network failure, not a GraphQL error
  if (status === 403) return /rate limit|abuse/i.test((error as Error).message);
  return status === 502 || status === 503 || status === 504 || status === 429;
}

/** Retry the transient failures big star histories hit: 502s, secondary rate limits, network blips. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  const attempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const wait = 2 ** attempt * 1000;
      const reason = String((error as Error).message)
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      log.warn(`GitHub API call failed (${reason}); retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

export function createGraphql(token: string, baseUrl = process.env.GITHUB_GRAPHQL_URL): GraphqlFn {
  const client = graphql.defaults({
    headers: { authorization: `token ${token}`, "user-agent": TOOL_NAME },
    ...(baseUrl && { baseUrl: baseUrl.replace(/\/graphql$/, "") }),
  });
  return <T>(query: string, variables: Record<string, unknown> = {}) =>
    withRetry(async () => {
      const data = await client<T>(query, variables);
      // A gateway error can come back as a 2xx with an HTML body: no data at all.
      if (data === undefined || data === null) throw new HttpError("empty response", 502);
      return data;
    });
}

export function createRest(
  token: string,
  baseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com",
): RestFn {
  return <T>(path: string, accept = "application/vnd.github+json") =>
    withRetry(async () => {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        headers: {
          authorization: `token ${token}`,
          accept,
          "user-agent": TOOL_NAME,
          "x-github-api-version": "2022-11-28",
        },
      });
      const text = await res.text();
      if (!res.ok) throw new HttpError(`${res.status} ${text.slice(0, 200)}`, res.status);
      return { data: JSON.parse(text) as T, link: res.headers.get("link") };
    });
}
