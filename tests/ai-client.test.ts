import { expect, test } from "bun:test";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { BudgetExhausted, createAiClient, settingsFor } from "../src/ai/client.js";
import { cleanDigest } from "../src/ai/digest.js";
import { config } from "./helpers.js";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function reply(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage,
    warnings: [],
  };
}

const rateLimited = (retryAfter: string) =>
  new APICallError({
    message: "Too many requests",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: { "retry-after": retryAfter },
    isRetryable: true,
  });

const options = { label: "mock", apiKey: "k", maxCalls: 3, minIntervalMs: 0 };

test("json parses structured output", async () => {
  const model = new MockLanguageModelV4({ doGenerate: reply('{"items":[{"n":1,"category":"Web"}]}') });
  const ai = createAiClient(model, options);
  const out = await ai.json({
    system: "s",
    prompt: "p",
    schema: z.object({ items: z.array(z.object({ n: z.number(), category: z.string() })) }),
  });
  expect(out.items[0]?.category).toBe("Web");
  expect(ai.remaining()).toBe(2);
});

test("a long Retry-After stops the run instead of waiting", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw rateLimited("3600");
    },
  });
  const ai = createAiClient(model, options);
  await expect(ai.text({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(BudgetExhausted);
  expect(ai.remaining()).toBe(0);
});

test("a short rate limit is retried", async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls++;
      if (calls === 1) throw rateLimited("0");
      return reply("ok");
    },
  });
  const ai = createAiClient(model, options);
  expect(await ai.text({ system: "s", prompt: "p" })).toBe("ok");
  expect(calls).toBe(2);
});

test("the call budget is enforced", async () => {
  const model = new MockLanguageModelV4({ doGenerate: reply("ok") });
  const ai = createAiClient(model, { ...options, maxCalls: 1 });
  await ai.text({ system: "s", prompt: "p" });
  await expect(ai.text({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(BudgetExhausted);
});

test("settings per provider", async () => {
  const gh = await settingsFor(config({ ai: true }).ai, "ghs_token");
  expect(gh).toEqual({
    apiKey: "ghs_token",
    model: "",
    customEndpoint: "https://models.github.ai/inference",
    customModel: "openai/gpt-4.1-mini",
  });
  const anthropic = await settingsFor(
    config({ ai: true, "ai-provider": "anthropic", "ai-api-key": "sk", "ai-model": "claude-haiku-5-5" }).ai,
    "t",
  );
  expect(anthropic).toMatchObject({ providerNpm: "@ai-sdk/anthropic", model: "claude-haiku-5-5" });
  const router = await settingsFor(
    config({ ai: true, "ai-provider": "openrouter", "ai-api-key": "sk", "ai-model": "x/y" }).ai,
    "t",
  );
  expect(router).toMatchObject({ providerApi: "https://openrouter.ai/api/v1" });
  await expect(settingsFor(config({ ai: true, "ai-provider": "custom" }).ai, "t")).rejects.toThrow(
    /ai-base-url/,
  );
  await expect(settingsFor(config({ ai: true, "ai-provider": "openai" }).ai, "t")).rejects.toThrow(
    /ai-api-key/,
  );
});

test("cleanDigest strips headings, links and HTML", () => {
  expect(cleanDigest("# Title\nSee [this](https://evil.test) <b>now</b>\n\n\n\nok")).toBe(
    "See this now\n\nok",
  );
});
