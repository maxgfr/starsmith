import * as core from "@actions/core";
import { parseArgs, readActionInputs, readConfigFile, resolveConfig } from "./config.js";
import { CONFIG_PATH } from "./constants.js";
import { createGraphql, createRest } from "./github/client.js";
import { log } from "./log.js";
import { run } from "./run.js";

/**
 * Entry point, for the Action and for local runs:
 *   node dist/index.js --username octocat --dry-run
 * `--workspace <dir>` points a local run at another checkout.
 */
async function main(): Promise<void> {
  const env = process.env;
  const args = parseArgs(process.argv.slice(2));
  const workspace = String(args.workspace ?? env.GITHUB_WORKSPACE ?? process.cwd());
  delete args.workspace;
  const configPath = String(args.config ?? env.INPUT_CONFIG ?? "").trim() || CONFIG_PATH;

  const config = resolveConfig(readConfigFile(workspace, configPath), readActionInputs(env), args);
  config.token ||= env.GITHUB_TOKEN ?? env.GH_TOKEN ?? "";
  config.username ||= env.GITHUB_REPOSITORY_OWNER ?? "";
  if (!config.token)
    throw new Error("No token: set the token input (defaults to github.token in the Action)");
  if (!config.branch && env.GITHUB_REF_TYPE === "branch") config.branch = env.GITHUB_REF_NAME ?? "";

  const inActions = env.GITHUB_ACTIONS === "true";
  const result = await run({
    config,
    workspace,
    gql: createGraphql(config.token),
    rest: createRest(config.token),
    repository: inActions ? env.GITHUB_REPOSITORY : undefined,
  });

  if (!inActions) {
    log.info(`Done: ${result.total} repositories, ${result.changes.length} file(s) changed`);
    return;
  }
  core.setOutput("changed", String(result.changed));
  core.setOutput("total", String(result.total));
  core.setOutput("new-stars", String(result.newStars));
  core.setOutput("group-by", result.groupBy);
  core.setOutput("files", result.files.join("\n"));
  core.setOutput("commit-sha", result.commit?.oid ?? "");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.env.GITHUB_ACTIONS === "true") core.setFailed(message);
  else {
    console.error(`error: ${message}`);
    process.exitCode = 1;
  }
});
