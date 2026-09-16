/**
 * In-memory sliding-window limiter for chat messages (cost and abuse control).
 * Per server process: with several instances each keeps its own count. The
 * password limit itself is enforced in the database (password-access.ts).
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  /** Records a hit if allowed. */
  hit(key: string, now = Date.now()): { allowed: true } | { allowed: false; retryAt: Date } {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { allowed: false, retryAt: new Date(recent[0] + this.windowMs) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return { allowed: true };
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= now - this.windowMs)) this.hits.delete(key);
    }
  }
}

/** Chat messages per signed-in user. */
export const userMessageLimiter = new SlidingWindowLimiter(20, 10 * 60 * 1000);
/** Logged denials per IP for people who aren't signed in, so the log can't be flooded. */
export const anonymousLimiter = new SlidingWindowLimiter(10, 10 * 60 * 1000);
