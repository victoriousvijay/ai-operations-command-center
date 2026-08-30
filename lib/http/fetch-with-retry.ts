import "server-only";

export interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

/**
 * fetch() with a hard timeout (AbortController) and a single bounded retry
 * on network failure or a 5xx response. Does not retry 4xx — those are
 * caller errors that won't succeed on repeat. Used by the real GHL and n8n
 * HTTP adapters; not needed by the mock adapters.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const { timeoutMs = 10_000, retries = 1, ...init } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`Received ${response.status} from ${url}`);
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt >= retries) {
        break;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Request to ${url} failed after ${retries + 1} attempt(s).`);
}
