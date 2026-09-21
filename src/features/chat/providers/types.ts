// Provider-neutral seam between the chat turn (PRD §6.3) and whichever model
// backs it (STYLES.md §2.6). The loop, the authorization gate and the tools
// stay in our code; a provider only translates messages and tool calls.
//
// The provider owns the conversation state for one turn, because each vendor
// requires its own message format to be echoed back verbatim (Anthropic wants
// its content blocks, Gemini wants its parts). A single shared representation
// would corrupt one or the other.
import type { ChatHistory } from "../history";

/** A tool as our code defines it, translated by each provider. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Our tools all take none. */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

/** A tool the model asked for. `id` is echoed back when the provider uses one. */
export interface ModelToolCall {
  id?: string;
  name: string;
}

export interface ToolOutcome {
  id?: string;
  name: string;
  text: string;
}

export type ModelReply =
  | { type: "text"; text: string }
  | { type: "tool_calls"; calls: ModelToolCall[] }
  /** The model declined on safety grounds; the caller answers with fixed text. */
  | { type: "refusal" };

/** One turn's conversation with the model. Not reused across turns. */
export interface ChatModelSession {
  /** Sends everything so far and returns what the model wants next. */
  send(): Promise<ModelReply>;
  /** Appends the results of the tools the model just asked for. */
  provideToolResults(results: ToolOutcome[]): void;
}

export interface ChatModelProvider {
  /** For logs and the live check; never shown to users. */
  readonly id: string;
  readonly model: string;
  start(input: { system: string; history: ChatHistory; tools: ToolSpec[] }): ChatModelSession;
}

/** Thrown when the provider is unreachable or rejects the request. */
export class ChatProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ChatProviderError";
  }
}
