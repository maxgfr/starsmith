import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { OPTION_NAMES } from "../src/config.js";

const action = parse(readFileSync(new URL("../action.yml", import.meta.url), "utf8")) as {
  inputs: Record<string, { default?: string }>;
};

test("action.yml declares every option, and only those", () => {
  const inputs = Object.keys(action.inputs).filter((name) => name !== "config");
  const options = OPTION_NAMES.filter((name) => name !== "overrides");
  expect(inputs.sort()).toEqual(options.sort());
});

test("only token has a default, so the config file is never overridden", () => {
  const withDefault = Object.entries(action.inputs)
    .filter(([, input]) => input.default !== undefined)
    .map(([name]) => name);
  expect(withDefault).toEqual(["token"]);
});
