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

let cached: ServerEnv | undefined;

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (source === process.env && cached) return cached;
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    // Report only which variables are wrong — never echo their values.
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid server environment:\n  ${issues.join("\n  ")}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}
