import { generateText, type LanguageModel, Output } from "ai";
import { describeError, type LlmError, type LlmSettings, loadModel } from "llm-connect";
import { latestModels } from "llm-models/browser";
import type { z } from "zod";
import type { AiConfig } from "../config.js";
import { OPENROUTER_ENDPOINT } from "../constants.js";
import { log } from "../log.js";

/** The run's AI call budget is spent, or the provider's quota is: stop and resume next run. */
export class BudgetExhausted extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BudgetExhausted";
  }
}

export class AiCallError extends Error {
  constructor(readonly detail: LlmError) {
    super(`${detail.code}${detail.status ? ` (${detail.status})` : ""}: ${detail.message || "no message"}`);
    this.name = "AiCallError";
  }
}

export interface AiClient {
  /** Provider and model, for logs. */
  readonly label: string;
  /** Calls left in this run's budget. */
  remaining(): number;
  json<T>(options: { system: string; prompt: string; schema: z.ZodType<T> }): Promise<T>;
  text(options: { system: string; prompt: string }): Promise<string>;
}

const PROVIDER_NPM: Record<string, string> = {
  openai: "@ai-sdk/openai",
  anthropic: "@ai-sdk/anthropic",
  google: "@ai-sdk/google",
  mistral: "@ai-sdk/mistral",
  openrouter: "@ai-sdk/openai-compatible",
};

/** The cheapest current tier of a catalog provider, from llm-models. */
export async function defaultModelFor(provider: string): Promise<string | null> {
  try {
    const result = await latestModels({ provider });
    const pick = result?.picks.find((p) => p.tier === "haiku") ?? result?.picks[0];
    if (!pick) return null;
    const { model } = pick;
    return model.api_id || model.id.replace(new RegExp(`^${provider}/`), "");
  } catch (error) {
    log.warn(`Could not resolve a default model for ${provider}: ${(error as Error).message}`);
    return null;
  }
}

/** The llm-connect settings the AI config points to. */
export async function settingsFor(ai: AiConfig): Promise<LlmSettings> {
  switch (ai.provider) {
    case undefined:
      throw new Error(
        "set ai-provider (openai, anthropic, google, mistral, openrouter or custom) and ai-api-key",
      );
    case "github-models":
      throw new Error(
        "GitHub Models was retired by GitHub on 2026-07-30: set ai-provider to another provider and its ai-api-key",
      );
    case "custom":
      if (!ai.baseUrl)
        throw new Error("ai-provider: custom needs ai-base-url (an OpenAI-compatible endpoint)");
      if (!ai.model) throw new Error("ai-provider: custom needs ai-model");
      return { apiKey: ai.apiKey, model: "", customEndpoint: ai.baseUrl, customModel: ai.model };
    default: {
      if (!ai.apiKey) throw new Error(`ai-provider: ${ai.provider} needs ai-api-key`);
      const model = ai.model || (await defaultModelFor(ai.provider));
      if (!model) throw new Error(`No default model found for ${ai.provider}: set ai-model`);
      const providerApi = ai.baseUrl || (ai.provider === "openrouter" ? OPENROUTER_ENDPOINT : undefined);
      return {
        apiKey: ai.apiKey,
        model,
        providerId: ai.provider,
        providerNpm: PROVIDER_NPM[ai.provider],
        ...(providerApi && { providerApi }),
      };
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterSeconds(error: unknown): number | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const headers = (current as { responseHeaders?: Record<string, string> }).responseHeaders;
    const value = headers?.["retry-after"] ?? headers?.["Retry-After"];
    if (value !== undefined) {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) return seconds;
      const date = Date.parse(value);
      if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
    }
    const next = current as { lastError?: unknown; cause?: unknown };
    current = next.lastError ?? next.cause;
  }
  return null;
}

/** Longest wait accepted on a rate limit; a longer one means a daily quota, so stop for this run. */
const MAX_WAIT_SECONDS = 90;

/**
 * A model wrapped with what a scheduled job needs: a call budget, pacing for free tiers, and
 * retries that give up (keeping what is done) when the provider asks to wait too long.
 */
export function createAiClient(
  model: LanguageModel,
  options: { label: string; apiKey: string; maxCalls: number; minIntervalMs: number },
): AiClient {
  let calls = 0;
  let last = 0;
  let exhausted: string | null = null;

  async function call<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      if (exhausted) throw new BudgetExhausted(exhausted);
      if (calls >= options.maxCalls) throw new BudgetExhausted(`ai-max-calls (${options.maxCalls}) reached`);
      const wait = last + options.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      calls++;
      last = Date.now();
      try {
        return await run();
      } catch (error) {
        const detail = describeError(error, options.apiKey);
        const retryAfter = retryAfterSeconds(error);
        if (detail.code === "rate-limit" && (retryAfter ?? 0) > MAX_WAIT_SECONDS) {
          exhausted = `rate limited for ${Math.round(retryAfter as number)}s`;
          throw new BudgetExhausted(exhausted);
        }
        if (!detail.retryable || attempt >= 3) {
          if (detail.code === "rate-limit") exhausted = "rate limited";
          throw new AiCallError(detail);
        }
        const delay = (retryAfter ?? 2 ** attempt * 2) * 1000;
        log.warn(`AI call failed (${detail.code}); retrying in ${Math.round(delay / 1000)}s`);
        await sleep(delay);
      }
    }
  }

  return {
    label: options.label,
    remaining: () => (exhausted ? 0 : Math.max(0, options.maxCalls - calls)),
    json: ({ system, prompt, schema }) =>
      call(async () => {
        const result = await generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema }),
          maxRetries: 0,
        });
        return result.output as z.infer<typeof schema>;
      }),
    text: ({ system, prompt }) =>
      call(async () => {
        const result = await generateText({ model, system, prompt, maxRetries: 0 });
        return result.text;
      }),
  };
}

/** The AI client for the config, or null (with a warning) when it cannot be set up. */
export async function openAiClient(ai: AiConfig): Promise<AiClient | null> {
  try {
    const settings = await settingsFor(ai);
    const model = await loadModel(settings);
    const id = settings.customModel || settings.model;
    return createAiClient(model, {
      label: `${ai.provider} · ${id}`,
      apiKey: settings.apiKey,
      maxCalls: ai.maxCalls,
      minIntervalMs: ai.minIntervalMs,
    });
  } catch (error) {
    log.warn(`AI disabled for this run: ${(error as Error).message}`);
    return null;
  }
}
