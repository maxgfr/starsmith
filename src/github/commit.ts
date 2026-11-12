import type { GraphqlFn } from "./client.js";

export interface FileChange {
  path: string;
  /** New contents, or null to delete the file. */
  contents: string | null;
}

const HEAD_QUERY = `
  query($owner: String!, $name: String!, $ref: String!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef { name }
      ref(qualifiedName: $ref) { target { oid } }
    }
  }
`;

const COMMIT_MUTATION = `
  mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) { commit { oid url } }
  }
`;

interface HeadResult {
  repository: { defaultBranchRef: { name: string } | null; ref: { target: { oid: string } } | null };
}

interface CommitResult {
  createCommitOnBranch: { commit: { oid: string; url: string } };
}

/**
 * Commit through the GraphQL API rather than `git push`: GitHub signs the commit itself, so it
 * shows as verified and passes branch protections that require signed commits.
 */
export async function commitFiles(
  gql: GraphqlFn,
  options: { repository: string; branch?: string; message: string; changes: FileChange[] },
): Promise<{ oid: string; url: string; branch: string }> {
  const [owner, name] = options.repository.split("/");
  if (!owner || !name) throw new Error(`Invalid repository "${options.repository}"`);
  let branch = options.branch;
  let head = await gql<HeadResult>(HEAD_QUERY, { owner, name, ref: `refs/heads/${branch ?? "HEAD"}` });
  if (!branch) {
    branch = head.repository.defaultBranchRef?.name;
    if (!branch) throw new Error(`${options.repository} has no default branch`);
    head = await gql<HeadResult>(HEAD_QUERY, { owner, name, ref: `refs/heads/${branch}` });
  }
  const oid = head.repository.ref?.target.oid;
  if (!oid) throw new Error(`Branch "${branch}" not found in ${options.repository}`);

  const additions = options.changes
    .filter((c) => c.contents !== null)
    .map((c) => ({ path: c.path, contents: Buffer.from(c.contents as string, "utf8").toString("base64") }));
  const deletions = options.changes.filter((c) => c.contents === null).map((c) => ({ path: c.path }));

  const [headline, ...body] = options.message.split("\n");
  const result = await gql<CommitResult>(COMMIT_MUTATION, {
    input: {
      branch: { repositoryNameWithOwner: options.repository, branchName: branch },
      expectedHeadOid: oid,
      message: { headline, ...(body.join("\n").trim() && { body: body.join("\n").trim() }) },
      fileChanges: { additions, deletions },
    },
  });
  return { ...result.createCommitOnBranch.commit, branch };
}
