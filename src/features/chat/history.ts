// What the browser is allowed to send as conversation history. Kept separate
// from the chat turn so the model providers can depend on it without a cycle.
import { z } from "zod";

export const MAX_TURNS = 20;
export const MAX_MESSAGE_CHARS = 2000;

// The browser sends plain text turns only. Tool calls and results are never
// accepted from the client, so a tampered history can't fake a tool result.
export const chatHistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    }),
  )
  .min(1)
  .max(MAX_TURNS)
  .refine((turns) => turns.every((t, i) => t.role === (i % 2 === 0 ? "user" : "assistant")), {
    message: "Turns must alternate, starting with the user",
  })
  .refine((turns) => turns.at(-1)?.role === "user", {
    message: "The last turn must be from the user",
  });

export type ChatHistory = z.infer<typeof chatHistorySchema>;
