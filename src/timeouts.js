// Outbound request budgets: 5s auth + 15s per model provider = 50s worst case with three providers.
export const AUTH_TIMEOUT_MS = 5000;
export const MODEL_TIMEOUT_MS = 15000;
export const CREATE_KEY_TIMEOUT_MS = 10000;

// Uses a ref'd timer (cleared on settle) so the timeout also holds when the
// process has no other active handles, such as in unit tests.
export async function fetchWithTimeout(fetcher, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
