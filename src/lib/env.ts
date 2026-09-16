import { z } from "zod";

// Server-side environment. Variables for later phases are optional here and
// become required in the phase that first uses them (see .env.example).
export const serverEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, "DATABASE_URL must be a mongodb:// or mongodb+srv:// URI"),
  // Overrides the database named in DATABASE_URL (defaults to "netguard").
  DATABASE_NAME: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const ROUTER_ADAPTERS = ["mock"] as const;

// Phase 1 — rotation engine. Validated separately so code that only needs the
// database doesn't require the encryption key.
export const rotationEnvSchema = z.object({
  NETGUARD_ENCRYPTION_KEY: z
    .string({ error: "NETGUARD_ENCRYPTION_KEY is required" })
    .refine(
      (value) => Buffer.from(value, "base64").length === 32,
      "NETGUARD_ENCRYPTION_KEY must be 32 bytes, base64-encoded",
    )
    .transform((value) => Buffer.from(value, "base64")),
  ROUTER_ADAPTER: z.enum(ROUTER_ADAPTERS).default("mock"),
  // Runs the scheduler inside the Next.js server (see src/instrumentation.ts).
  ROTATION_SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type RotationEnv = z.infer<typeof rotationEnvSchema>;

function parseEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Report only which variables are wrong — never echo their values.
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid server environment:\n  ${issues.join("\n  ")}`);
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (source === process.env && cached) return cached;
  const env = parseEnv(serverEnvSchema, source);
  if (source === process.env) cached = env;
  return env;
}

// Not cached, so tests can set the key at runtime; parsing is cheap.
export function getRotationEnv(source: NodeJS.ProcessEnv = process.env): RotationEnv {
  return parseEnv(rotationEnvSchema, source);
}
