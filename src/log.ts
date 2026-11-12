import * as core from "@actions/core";

const inActions = process.env.GITHUB_ACTIONS === "true";
let quiet = false;

/** Logging that goes through the Actions toolkit in CI and to the console locally. */
export const log = {
  info(message: string): void {
    if (quiet) return;
    if (inActions) core.info(message);
    else console.log(message);
  },
  warn(message: string): void {
    if (quiet) return;
    if (inActions) core.warning(message);
    else console.warn(`warning: ${message}`);
  },
  async group<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (inActions && !quiet) return core.group(name, fn);
    log.info(`▸ ${name}`);
    return fn();
  },
  /** Silence everything, for tests. */
  setQuiet(value: boolean): void {
    quiet = value;
  },
};
