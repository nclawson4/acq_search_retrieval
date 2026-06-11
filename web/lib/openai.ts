import OpenAI from "openai";
import { OPENAI_API_KEY } from "./env";

let _client: OpenAI | null = null;

export function openai() {
  if (!_client) _client = new OpenAI({ apiKey: OPENAI_API_KEY() });
  return _client;
}

export const CHAT_MODEL = "gpt-4o-mini";

// Pricing per 1M tokens for gpt-4o-mini (input / output). Used for per-query
// cost telemetry — accuracy is "close enough for an internal usage cap".
export const CHAT_PRICE_INPUT_PER_M = 0.15;
export const CHAT_PRICE_OUTPUT_PER_M = 0.60;
export const EMBED_PRICE_PER_M = 0.02;

export interface TokenUsage {
  input: number;
  output: number;
  embed: number;
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, embed: 0 };
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    input: a.input + (b.input ?? 0),
    output: a.output + (b.output ?? 0),
    embed: a.embed + (b.embed ?? 0),
  };
}

export function usageCostUSD(u: TokenUsage): number {
  return (
    (u.input * CHAT_PRICE_INPUT_PER_M) / 1_000_000 +
    (u.output * CHAT_PRICE_OUTPUT_PER_M) / 1_000_000 +
    (u.embed * EMBED_PRICE_PER_M) / 1_000_000
  );
}
