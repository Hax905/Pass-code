// Picks the model provider from the environment (STYLES.md §2.6).
import { getChatEnv } from "@/lib/env";

import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { ChatProviderError, type ChatModelProvider } from "./types";

export * from "./types";
export { createAnthropicProvider } from "./anthropic";
export { createGeminiProvider, DEFAULT_GEMINI_MODELS } from "./gemini";

export function createChatProvider(env = getChatEnv()): ChatModelProvider {
  if (env.CHAT_PROVIDER === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new ChatProviderError("ANTHROPIC_API_KEY is not configured", 500);
    }
    return createAnthropicProvider();
  }
  if (!env.GEMINI_API_KEY) {
    throw new ChatProviderError("GEMINI_API_KEY is not configured", 500);
  }
  return createGeminiProvider({
    apiKey: env.GEMINI_API_KEY,
    ...(env.GEMINI_MODELS ? { models: env.GEMINI_MODELS } : {}),
  });
}
