import { describe, expect, test } from "bun:test";
import { compactNumber, escapeMarkdown, fileSlug, Slugger, shieldsText } from "../src/render/format.js";
import { roundStars } from "../src/render/json.js";

describe("compactNumber", () => {
  test.each([
    [0, "0"],
    [999, "999"],
    [1000, "1k"],
    [1234, "1.2k"],
    [12_278, "12.3k"],
    [123_456, "123k"],
    [999_999, "1M"],
    [1_250_000, "1.3M"],
  ])("%d → %s", (n, out) => {
    expect(compactNumber(n)).toBe(out);
  });
});

test("roundStars keeps three significant digits", () => {
  expect(roundStars(999, "compact")).toBe(999);
  expect(roundStars(12_278, "compact")).toBe(12_300);
  expect(roundStars(240_149, "compact")).toBe(240_000);
  expect(roundStars(12_278, "exact")).toBe(12_278);
});

test("Slugger matches GitHub anchors, repeats included", () => {
  const s = new Slugger();
  expect(s.slug("C")).toBe("c");
  expect(s.slug("C#")).toBe("c-1");
  expect(s.slug("C++")).toBe("c-2");
  expect(s.slug("Objective-C")).toBe("objective-c");
  expect(s.slug("Objective-C++")).toBe("objective-c-1");
  expect(s.slug("PEG.js")).toBe("pegjs");
  expect(s.slug("📌 Pinned")).toBe("-pinned");
  expect(s.slug("DevOps & Infrastructure")).toBe("devops--infrastructure");
  expect(s.slug("Développement Web")).toBe("développement-web");
});

test("fileSlug spells out symbols and stays unique", () => {
  const taken = new Set<string>();
  expect(fileSlug("C", taken)).toBe("c");
  expect(fileSlug("C#", taken)).toBe("c-sharp");
  expect(fileSlug("C++", taken)).toBe("c-plus-plus");
  expect(fileSlug("Développement Web", taken)).toBe("developpement-web");
  expect(fileSlug("c", taken)).toBe("c-2");
});

test("escapeMarkdown neutralizes table and HTML syntax", () => {
  expect(escapeMarkdown("a | b <script> [x](y)\nz")).toBe("a \\| b &lt;script&gt; \\[x\\](y) z");
});

test("shieldsText escapes dashes, underscores and spaces", () => {
  expect(shieldsText("2026-11-12")).toBe("2026--11--12");
  expect(shieldsText("Mis à jour")).toBe("Mis_%C3%A0_jour");
});
