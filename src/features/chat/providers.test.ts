// What each provider actually puts on the wire. The shared turn logic is
// tested in chat.integration.test.ts against a provider-neutral fake.
import type Anthropic from "@anthropic-ai/sdk";
import type { Content, GenerateContentResponse } from "@google/genai";
import { describe, expect, it } from "vitest";

import { CHAT_TOOLS, TOOL_NAMES } from "./prompt";
import { createAnthropicProvider, type AnthropicChatClient } from "./providers/anthropic";
import { createGeminiProvider, type GeminiChatClient } from "./providers/gemini";
import { createChatProvider } from "./providers";
import { ChatProviderError } from "./providers/types";
import { getChatEnv } from "@/lib/env";

const history = [{ role: "user" as const, content: "can i have the wifi password?" }];
const start = (provider: ReturnType<typeof createGeminiProvider>) =>
  provider.start({ system: "SYSTEM PROMPT", history, tools: CHAT_TOOLS });

describe("anthropic provider", () => {
  function fakeAnthropic(responses: Partial<Anthropic.Beta.BetaMessage>[]) {
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    let index = 0;
    const client: AnthropicChatClient = {
      beta: {
        messages: {
          async create(p) {
            params.push(JSON.parse(JSON.stringify(p)));
            return {
              id: "msg_1",
              type: "message",
              role: "assistant",
              model: "claude-opus-5",
              usage: { input_tokens: 1, output_tokens: 1 },
              ...responses[Math.min(index++, responses.length - 1)],
            } as unknown as Anthropic.Beta.BetaMessage;
          },
        },
      },
    };
    return { client, params };
  }

  it("sends the documented request shape", async () => {
    const { client, params } = fakeAnthropic([
      { stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] as never },
    ]);
    const reply = await start(createAnthropicProvider(client) as never).send();

    expect(reply).toEqual({ type: "text", text: "hi" });
    expect(params[0]).toMatchObject({
      model: "claude-opus-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      messages: history,
    });
    expect(params[0].tools?.map((t) => ("name" in t ? t.name : ""))).toEqual(
      Object.values(TOOL_NAMES),
    );
    expect(params[0].tools?.every((t) => "strict" in t && t.strict === true)).toBe(true);
    expect(params[0]).not.toHaveProperty("thinking");
  });

  it("reports tool calls and echoes the blocks back with the results", async () => {
    const { client, params } = fakeAnthropic([
      {
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "reasoning", signature: "sig" },
          { type: "tool_use", id: "toolu_9", name: TOOL_NAMES.showPassword, input: {} },
        ] as never,
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] as never },
    ]);
    const session = start(createAnthropicProvider(client) as never);

    expect(await session.send()).toEqual({
      type: "tool_calls",
      calls: [{ id: "toolu_9", name: TOOL_NAMES.showPassword }],
    });
    session.provideToolResults([{ id: "toolu_9", name: TOOL_NAMES.showPassword, text: "Shown." }]);
    await session.send();

    // The thinking block is echoed back unchanged, as the API requires.
    expect(params[1].messages[1]).toMatchObject({ role: "assistant" });
    expect(JSON.stringify(params[1].messages[1])).toContain("thinking");
    expect(params[1].messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "Shown." }],
    });
  });

  it("maps a refusal to the fixed reply path", async () => {
    const { client } = fakeAnthropic([{ stop_reason: "refusal", content: [] }]);
    expect(await start(createAnthropicProvider(client) as never).send()).toEqual({
      type: "refusal",
    });
  });
});

describe("gemini provider", () => {
  function fakeGemini(
    handler: (model: string, contents: Content[]) => Partial<GenerateContentResponse>,
  ) {
    const calls: { model: string; contents: Content[]; config?: Record<string, unknown> }[] = [];
    const client: GeminiChatClient = {
      models: {
        async generateContent({ model, contents, config }) {
          calls.push(JSON.parse(JSON.stringify({ model, contents, config })));
          const result = handler(model, contents);
          if (result instanceof Error) throw result;
          return result as GenerateContentResponse;
        },
      },
    };
    return { client, calls };
  }

  const textResponse = (text: string) =>
    ({
      text,
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }],
    }) as unknown as GenerateContentResponse;

  it("maps history to contents and tools to functionDeclarations", async () => {
    const { client, calls } = fakeGemini(() => textResponse("hello"));
    const reply = await start(createGeminiProvider({ client })).send();

    expect(reply).toEqual({ type: "text", text: "hello" });
    expect(calls[0].model).toBe("gemini-3.8-flash");
    expect(calls[0].contents).toEqual([
      { role: "user", parts: [{ text: "can i have the wifi password?" }] },
    ]);
    const config = calls[0].config as {
      systemInstruction: string;
      tools: { functionDeclarations: { name: string; parametersJsonSchema: unknown }[] }[];
    };
    expect(config.systemInstruction).toBe("SYSTEM PROMPT");
    expect(config.tools[0].functionDeclarations.map((f) => f.name)).toEqual(
      Object.values(TOOL_NAMES),
    );
    expect(config.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("detects a function call even though the finish reason is STOP", async () => {
    const call = { name: TOOL_NAMES.showPassword, args: {}, id: "call_7" };
    const { client, calls } = fakeGemini((_model, contents) =>
      contents.length === 1
        ? ({
            functionCalls: [call],
            candidates: [
              { finishReason: "STOP", content: { role: "model", parts: [{ functionCall: call }] } },
            ],
          } as unknown as GenerateContentResponse)
        : textResponse("shown"),
    );
    const session = start(createGeminiProvider({ client }));

    expect(await session.send()).toEqual({
      type: "tool_calls",
      calls: [{ id: "call_7", name: TOOL_NAMES.showPassword }],
    });
    session.provideToolResults([{ id: "call_7", name: TOOL_NAMES.showPassword, text: "Shown." }]);
    expect(await session.send()).toEqual({ type: "text", text: "shown" });

    // The model's own parts come back, then the result as a user-role part.
    expect(calls[1].contents[1]).toMatchObject({ role: "model" });
    expect(calls[1].contents[2]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "call_7",
            name: TOOL_NAMES.showPassword,
            response: { output: "Shown." },
          },
        },
      ],
    });
  });

  it("treats a blocked answer as a refusal, not a failure", async () => {
    const { client } = fakeGemini(
      () => ({ candidates: [{ finishReason: "SAFETY" }] }) as unknown as GenerateContentResponse,
    );
    expect(await start(createGeminiProvider({ client })).send()).toEqual({ type: "refusal" });
  });

  it("walks the model list when the free tier is out of capacity", async () => {
    const attempted: string[] = [];
    const { client } = fakeGemini((model) => {
      attempted.push(model);
      if (model !== "gemini-3.6-flash") {
        throw Object.assign(new Error("high demand"), { status: 503 });
      }
      return textResponse("ok");
    });
    const provider = createGeminiProvider({ client, retryDelayMs: 0 });

    expect(await start(provider).send()).toEqual({ type: "text", text: "ok" });
    expect(attempted).toEqual(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]);
  });

  it("gives up with a retryable error when every model is unavailable", async () => {
    const { client } = fakeGemini(() => {
      throw Object.assign(new Error("high demand"), { status: 503 });
    });
    const session = start(createGeminiProvider({ client, retryDelayMs: 0 }));
    await expect(session.send()).rejects.toMatchObject({
      name: "ChatProviderError",
      retryable: true,
      status: 503,
    });
  });

  it("retries a dropped connection, which carries no status", async () => {
    // undici reports a dropped socket as TypeError "fetch failed" wrapping the
    // real cause, so there is no status to match on.
    const attempted: string[] = [];
    const { client } = fakeGemini((model) => {
      attempted.push(model);
      if (model === "gemini-3.8-flash") {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
        });
      }
      return textResponse("ok");
    });
    const provider = createGeminiProvider({ client, retryDelayMs: 0 });

    expect(await start(provider).send()).toEqual({ type: "text", text: "ok" });
    expect(attempted).toEqual(["gemini-3.8-flash", "gemini-3.7-flash"]);
  });

  it("gives up with a retryable error when the connection keeps dropping", async () => {
    const { client } = fakeGemini(() => {
      throw new TypeError("fetch failed");
    });
    const session = start(createGeminiProvider({ client, retryDelayMs: 0 }));
    await expect(session.send()).rejects.toMatchObject({
      name: "ChatProviderError",
      retryable: true,
      status: 503,
    });
  });

  it("gives up on a stalled model and fails over to the next one", async () => {
    // Google can accept the connection and then go quiet; no status, no socket
    // error, so only a timeout gets the turn moving again.
    const attempted: string[] = [];
    const client: GeminiChatClient = {
      models: {
        generateContent({ model }) {
          attempted.push(model);
          if (model === "gemini-3.8-flash") return new Promise(() => {}); // never settles
          return Promise.resolve(textResponse("ok"));
        },
      },
    };
    const provider = createGeminiProvider({ client, retryDelayMs: 0, requestTimeoutMs: 20 });

    expect(await start(provider).send()).toEqual({ type: "text", text: "ok" });
    expect(attempted).toEqual(["gemini-3.8-flash", "gemini-3.7-flash"]);
  });

  it("surfaces a retryable error when every model stalls", async () => {
    const client: GeminiChatClient = {
      models: {
        generateContent: () => new Promise(() => {}),
      },
    };
    const session = start(createGeminiProvider({ client, retryDelayMs: 0, requestTimeoutMs: 10 }));
    await expect(session.send()).rejects.toMatchObject({
      name: "ChatProviderError",
      retryable: true,
    });
  });

  it("fails fast on an error that retrying cannot fix", async () => {
    const { client } = fakeGemini(() => {
      throw Object.assign(new Error("bad key"), { status: 401 });
    });
    const session = start(createGeminiProvider({ client, retryDelayMs: 0 }));
    const error = await session.send().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatProviderError);
    expect(error).toMatchObject({ status: 401, retryable: false });
  });
});

describe("provider selection", () => {
  const base = { GEMINI_API_KEY: "test-key", CHAT_PROVIDER: "gemini" } as const;

  it("defaults to Gemini and reads the model list from the environment", () => {
    const env = getChatEnv({ ...base } as unknown as NodeJS.ProcessEnv);
    expect(env.CHAT_PROVIDER).toBe("gemini");
    expect(createChatProvider(env).id).toBe("gemini");

    const pinned = getChatEnv({
      ...base,
      GEMINI_MODELS: "gemini-3.6-flash, gemini-flash-latest",
    } as unknown as NodeJS.ProcessEnv);
    expect(pinned.GEMINI_MODELS).toEqual(["gemini-3.6-flash", "gemini-flash-latest"]);
    expect(createChatProvider(pinned).model).toBe("gemini-3.6-flash");
  });

  it("selects Anthropic when asked", () => {
    const env = getChatEnv({
      CHAT_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "test-key",
    } as unknown as NodeJS.ProcessEnv);
    const provider = createChatProvider(env);
    expect(provider.id).toBe("anthropic");
    expect(provider.model).toBe("claude-opus-5");
  });

  it("refuses to start without the selected provider's key", () => {
    for (const env of [
      { CHAT_PROVIDER: "gemini" },
      { CHAT_PROVIDER: "anthropic" },
    ] as unknown as NodeJS.ProcessEnv[]) {
      expect(() => createChatProvider(getChatEnv(env))).toThrow(ChatProviderError);
    }
  });

  it("rejects an unknown provider rather than falling back", () => {
    expect(() => getChatEnv({ CHAT_PROVIDER: "openai" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});
