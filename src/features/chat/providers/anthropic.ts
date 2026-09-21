// Anthropic (Claude) provider. This is the original Phase 4 implementation,
// moved behind the provider seam unchanged in behaviour.
import Anthropic from "@anthropic-ai/sdk";

import type { ChatHistory } from "../history";
import {
  ChatProviderError,
  type ChatModelProvider,
  type ChatModelSession,
  type ModelReply,
  type ToolOutcome,
  type ToolSpec,
} from "./types";

export const ANTHROPIC_CHAT_MODEL = "claude-opus-5";

/** The part of the Anthropic client this module uses (lets tests pass a fake). */
export interface AnthropicChatClient {
  beta: {
    messages: {
      create(
        params: Anthropic.Beta.MessageCreateParamsNonStreaming,
      ): Promise<Anthropic.Beta.BetaMessage>;
    };
  };
}

function toTools(tools: ToolSpec[]): Anthropic.Beta.BetaTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    strict: true,
  }));
}

class AnthropicSession implements ChatModelSession {
  private readonly messages: Anthropic.Beta.BetaMessageParam[];

  constructor(
    private readonly client: AnthropicChatClient,
    private readonly system: string,
    history: ChatHistory,
    private readonly tools: ToolSpec[],
  ) {
    this.messages = history.map((turn) => ({ role: turn.role, content: turn.content }));
  }

  async send(): Promise<ModelReply> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: ANTHROPIC_CHAT_MODEL,
        max_tokens: 16000,
        // A request declined by Claude Opus 5's safety classifiers is retried
        // on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Short conversational answers don't need deep reasoning.
        output_config: { effort: "low" },
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: this.system }],
        tools: toTools(this.tools),
        messages: this.messages,
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        throw new ChatProviderError("Anthropic rate limit", 429, true);
      }
      if (error instanceof Anthropic.APIError) {
        throw new ChatProviderError(`Anthropic error ${error.status}`, error.status, false);
      }
      throw new ChatProviderError(
        error instanceof Error ? error.message : "Anthropic request failed",
      );
    }

    if (response.stop_reason === "refusal") return { type: "refusal" };

    if (response.stop_reason === "pause_turn") {
      this.messages.push({ role: "assistant", content: response.content });
      return { type: "tool_calls", calls: [] };
    }

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      return { type: "text", text };
    }

    // Keep thinking and tool_use blocks exactly as returned.
    this.messages.push({ role: "assistant", content: response.content });
    const calls = response.content.flatMap((block) =>
      block.type === "tool_use" ? [{ id: block.id, name: block.name }] : [],
    );
    return { type: "tool_calls", calls };
  }

  provideToolResults(results: ToolOutcome[]) {
    if (results.length === 0) return;
    this.messages.push({
      role: "user",
      content: results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.id ?? "",
        content: result.text,
      })),
    });
  }
}

export function createAnthropicProvider(client?: AnthropicChatClient): ChatModelProvider {
  const resolved = client ?? (new Anthropic() as AnthropicChatClient);
  return {
    id: "anthropic",
    model: ANTHROPIC_CHAT_MODEL,
    start: ({ system, history, tools }) => new AnthropicSession(resolved, system, history, tools),
  };
}
