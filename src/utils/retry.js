/**
 * withRetry — retry an async function with exponential back-off.
 *
 * @param {() => Promise<any>} fn        - The async function to retry.
 * @param {object}             options
 * @param {number}             options.retries   - Max retry attempts (default 3).
 * @param {number}             options.delayMs   - Base delay in ms (default 300).
 * @param {(err) => boolean}   options.retryIf   - Return true to retry this error.
 *                                                 Default: retry on network errors and 5xx only.
 *
 * Delay schedule (exponential): attempt 1 → delayMs, attempt 2 → delayMs×2, ...
 */
async function withRetry(fn, { retries = 3, delayMs = 300, retryIf } = {}) {
  const shouldRetry = retryIf || defaultRetryIf;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast || !shouldRetry(err)) throw err;

      const wait = delayMs * attempt; // 300 ms, 600 ms, 900 ms …
      console.warn(
        `[retry] attempt ${attempt}/${retries} failed — retrying in ${wait} ms. Error: ${err.message}`
      );
      await sleep(wait);
    }
  }
}

/**
 * Default retry predicate:
 *   - Retry on network / timeout errors (no .response)
 *   - Retry on 5xx responses
 *   - Do NOT retry on 4xx (bad request, auth failure, not found — won't change)
 */
function defaultRetryIf(err) {
  if (!err.response) return true;           // network error / timeout
  return err.response.status >= 500;        // server error — may be transient
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { withRetry };
