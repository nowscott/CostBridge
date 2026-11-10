// Outbound request budgets: 5s auth + 20s primary + 20s fallback = 45s worst case.
export const AUTH_TIMEOUT_MS = 5000;
export const MODEL_TIMEOUT_MS = 20000;
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
