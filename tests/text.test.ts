import { expect, test } from "bun:test";
import { cleanDescription } from "../src/ai/describe.js";
import { cleanDigest } from "../src/ai/digest.js";
import { repoLine } from "../src/ai/prompt.js";
import { truncate } from "../src/text.js";
import { repo } from "./helpers.js";

const EMOJI_AT_CUT = `${"a".repeat(79)}😀 tail`;

test("truncate never splits a surrogate pair", () => {
  expect(truncate(EMOJI_AT_CUT, 80)).toBe("a".repeat(79));
  expect(truncate(EMOJI_AT_CUT, 81)).toBe(`${"a".repeat(79)}😀`);
  expect(truncate("short", 80)).toBe("short");
  expect(truncate("bad \ud83d half", 80).isWellFormed()).toBe(true);
});

test("prompt lines stay well-formed JSON for the provider", () => {
  // Anthropic answered 400 "unexpected end of hex escape" on a lone surrogate.
  const line = repoLine(repo({ nameWithOwner: "o/r", description: EMOJI_AT_CUT }), 1, 80);
  expect(line.isWellFormed()).toBe(true);
  expect(JSON.stringify(line)).not.toContain("\\ud83d");
});

test("model output is cut between code points too", () => {
  expect(cleanDescription(`${"x".repeat(138)}😀😀😀`)?.isWellFormed()).toBe(true);
  expect(cleanDigest(`${"x".repeat(1499)}😀`).isWellFormed()).toBe(true);
});
