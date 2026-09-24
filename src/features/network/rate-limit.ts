/**
 * Connect-attempt limits for the virtual Wi-Fi.
 *
 * The connect form necessarily tells the caller whether a guess is the current
 * password, which nothing else in PassCode does. These limits are what keeps
 * that from being usable as a brute-force oracle: the generated password is 20
 * characters from a large alphabet, so a few dozen guesses per ten minutes is
 * nowhere near enough to matter, while still leaving room for a room full of
 * real devices reconnecting after a rotation.
 *
 * In memory, so the counts are per server process (same tradeoff as the chat
 * limiter, STYLES.md §2.6). The demo runs one process.
 */
import { SlidingWindowLimiter } from "@/features/chat/rate-limit";

const TEN_MINUTES = 10 * 60 * 1000;

/** Connect attempts per browser. */
export const clientConnectLimiter = new SlidingWindowLimiter(12, TEN_MINUTES);
/** Connect attempts per source IP, so one browser's limit isn't the only bound. */
export const ipConnectLimiter = new SlidingWindowLimiter(40, TEN_MINUTES);
