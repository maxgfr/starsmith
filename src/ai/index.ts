import type { AiConfig } from "../config.js";
import { log } from "../log.js";
import type { State } from "../state.js";
import type { Repo } from "../types.js";
import { categorize } from "./categorize.js";
import { type AiClient, BudgetExhausted, openAiClient } from "./client.js";
import { describe } from "./describe.js";
import { digestNeeded, digestWindow, writeDigest } from "./digest.js";

export { categoryCoverage, categoryOf } from "./categorize.js";
export { describedOf } from "./describe.js";
export { digestWindow } from "./digest.js";

/**
 * Run the enabled AI features on what is not done yet. Never throws: a provider failure leaves
 * the cached results in place and the list renders without the missing parts.
 */
export async function runAi(
  repos: Repo[],
  state: State,
  cfg: AiConfig,
  options: { token: string; today: string; client?: AiClient | null },
): Promise<void> {
  const ai = options.client === undefined ? await openAiClient(cfg, options.token) : options.client;
  if (!ai) return;
  log.info(`AI: ${ai.label}, up to ${ai.remaining()} calls`);
  const features = new Set(cfg.features);
  const window = features.has("digest") ? digestWindow(repos, cfg, options.today) : [];
  // Keep one call for the digest: it is what readers see first.
  const reserve = features.has("digest") && digestNeeded(window, state, cfg) ? 1 : 0;
  const limited = withReserve(ai, reserve);

  // Each step fails on its own: a bad taxonomy answer must not cost the digest.
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      const message = (error as Error).message;
      if (error instanceof BudgetExhausted) log.info(`AI ${name} stopped: ${message}`);
      else log.warn(`AI ${name} failed, continuing without it: ${message}`);
    }
  };
  if (features.has("categorize")) await step("categories", () => categorize(repos, state, limited, cfg));
  if (features.has("describe")) await step("descriptions", () => describe(repos, state, limited, cfg));
  if (features.has("digest")) {
    if (!window.length) state.digest = null;
    else if (reserve) await step("digest", () => writeDigest(window, state, ai, cfg));
  }
}

/** A client that refuses calls once only `reserve` are left, so later steps still get theirs. */
function withReserve(ai: AiClient, reserve: number): AiClient {
  if (!reserve) return ai;
  const guard = () => {
    if (ai.remaining() <= reserve) throw new BudgetExhausted("calls left are kept for the digest");
  };
  return {
    label: ai.label,
    remaining: () => Math.max(0, ai.remaining() - reserve),
    json: async (o) => {
      guard();
      return ai.json(o);
    },
    text: async (o) => {
      guard();
      return ai.text(o);
    },
  };
}
