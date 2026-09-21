// Google Gemini provider (pivot 2026-09-20, TASKLIST.md Phase 4).
//
// Uses the stateless `models.generateContent` call, not the newer server-side
// `interactions` API: PassCode sends the validated history on every turn and
// keeps no conversation state at the provider.
//
// The free tier answers 503 UNAVAILABLE under load, model by model and minute
// by minute, so a request walks a list of models before giving up.
import { GoogleGenAI, type Content, type GenerateContentResponse, type Part } from "@google/genai";

import type { ChatHistory } from "../history";
import {
  ChatProviderError,
  type ChatModelProvider,
  type ChatModelSession,
  type ModelReply,
  type ToolOutcome,
  type ToolSpec,
} from "./types";

// Tried in order; a 503/429/connection drop moves on to the next one. Each
// entry must be a distinct model that currently serves generateContent:
// - an alias (`gemini-flash-latest`) shares the newest model's quota bucket,
//   so it adds a step to the walk without adding capacity;
// - a retired model answers 404, which is not retryable and ends the walk.
// Verified 2026-09-20: 3.5-flash-lite through 3.8-flash serve; 2.5-flash is
// retired although the models list still advertises it.
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

const RETRY_PASSES = 2;
const RETRY_DELAY_MS = 1500;

// Gemini reports a blocked answer as a finish reason rather than a distinct
// stop reason; these all mean "declined", not "failed".
const REFUSAL_FINISH_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_SAFETY",
]);

/** The part of the Gemini client this module uses (lets tests pass a fake). */
export interface GeminiChatClient {
  models: {
    generateContent(params: {
      model: string;
      contents: Content[];
      config?: Record<string, unknown>;
    }): Promise<GenerateContentResponse>;
  };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

// A dropped connection carries no HTTP status: undici reports it as a
// TypeError "fetch failed" wrapping the real cause. The free tier drops
// connections about as readily as it answers 503, and both mean "try again".
const TRANSPORT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isTransportError(error: unknown): boolean {
  let current: unknown = error;
  // Follow the `cause` chain; undici nests the real socket error one or two deep.
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    if (current.message === "fetch failed") return true;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && TRANSPORT_ERROR_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Capacity and connection problems are worth another model or another pass. */
function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 503 || status === 429 || status === 500) return true;
  return status === undefined && isTransportError(error);
}

class GeminiSession implements ChatModelSession {
  private readonly contents: Content[];

  constructor(
    private readonly client: GeminiChatClient,
    private readonly system: string,
    history: ChatHistory,
    private readonly tools: ToolSpec[],
    private readonly models: readonly string[],
    private readonly delayMs: number,
  ) {
    this.contents = history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    }));
  }

  private get config() {
    return {
      systemInstruction: this.system,
      tools: [
        {
          functionDeclarations: this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.parameters,
          })),
        },
      ],
    };
  }

  /** Walks the model list on capacity errors; anything else fails straight away. */
  private async generate(): Promise<GenerateContentResponse> {
    let last: unknown;
    for (let pass = 0; pass < RETRY_PASSES; pass++) {
      for (const model of this.models) {
        try {
          return await this.client.models.generateContent({
            model,
            contents: this.contents,
            config: this.config,
          });
        } catch (error) {
          last = error;
          if (!isRetryable(error)) {
            throw new ChatProviderError(
              error instanceof Error ? error.message : "Gemini request failed",
              statusOf(error),
              false,
            );
          }
        }
      }
      if (pass < RETRY_PASSES - 1 && this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
    }
    throw new ChatProviderError(
      last instanceof Error ? last.message : "Gemini is unavailable",
      statusOf(last) ?? 503,
      true,
    );
  }

  async send(): Promise<ModelReply> {
    const response = await this.generate();

    const blockReason = response.promptFeedback?.blockReason;
    const finishReason = response.candidates?.[0]?.finishReason;
    if (blockReason || (finishReason && REFUSAL_FINISH_REASONS.has(String(finishReason)))) {
      return { type: "refusal" };
    }

    // A tool call arrives with finishReason STOP, so the calls decide, not it.
    const calls = response.functionCalls ?? [];
    if (calls.length > 0) {
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) this.contents.push({ role: "model", parts });
      return {
        type: "tool_calls",
        calls: calls.map((call) => ({
          ...(call.id ? { id: call.id } : {}),
          name: call.name ?? "",
        })),
      };
    }

    const text = (response.text ?? "").trim();
    return { type: "text", text };
  }

  provideToolResults(results: ToolOutcome[]) {
    if (results.length === 0) return;
    const parts: Part[] = results.map((result) => ({
      functionResponse: {
        ...(result.id ? { id: result.id } : {}),
        name: result.name,
        // "output" is the documented key for a successful function result.
        response: { output: result.text },
      },
    }));
    this.contents.push({ role: "user", parts });
  }
}

export function createGeminiProvider(options: {
  apiKey?: string;
  models?: readonly string[];
  client?: GeminiChatClient;
  retryDelayMs?: number;
}): ChatModelProvider {
  const models = options.models?.length ? options.models : DEFAULT_GEMINI_MODELS;
  const client =
    options.client ?? (new GoogleGenAI({ apiKey: options.apiKey }) as GeminiChatClient);
  return {
    id: "gemini",
    model: models[0],
    start: ({ system, history, tools }) =>
      new GeminiSession(
        client,
        system,
        history,
        tools,
        models,
        options.retryDelayMs ?? RETRY_DELAY_MS,
      ),
  };
}
