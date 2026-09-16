// Runs once per Next.js server start. Starts the rotation scheduler in-process
// when ROTATION_SCHEDULER_ENABLED=true (otherwise use `npm run rotation:worker`).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ROTATION_SCHEDULER_ENABLED !== "true") return;

  const { getRotationEnv } = await import("@/lib/env");
  const { startRotationScheduler } = await import("@/features/rotation/scheduler");
  getRotationEnv(); // fail fast on a missing/invalid encryption key

  // Survive dev hot reloads without starting a second scheduler.
  const globalForScheduler = globalThis as { netguardRotationScheduler?: unknown };
  globalForScheduler.netguardRotationScheduler ??= startRotationScheduler();
}
