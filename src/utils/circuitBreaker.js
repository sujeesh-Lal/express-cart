/**
 * Circuit Breaker
 *
 * States:
 *   CLOSED    — normal operation; failures are counted within a rolling window
 *   OPEN      — threshold exceeded; all calls are rejected (fallback used)
 *   HALF_OPEN — recovery probe; one trial call is allowed through
 *
 * Config (all durations in milliseconds):
 *   failureThreshold  — number of failures inside windowMs before tripping (default 3)
 *   windowMs          — rolling window for counting failures (default 30 000 = 30 s)
 *   recoveryTimeoutMs — how long to stay OPEN before attempting HALF_OPEN (default 60 000)
 */

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.windowMs = options.windowMs ?? 30_000;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 60_000;

    this.state = STATES.CLOSED;
    this.failures = []; // timestamps of recent failures
    this.openedAt = null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _pruneOldFailures() {
    const cutoff = Date.now() - this.windowMs;
    this.failures = this.failures.filter((ts) => ts > cutoff);
  }

  _trip() {
    this.state = STATES.OPEN;
    this.openedAt = Date.now();
    console.warn(
      `[CircuitBreaker:${this.name}] OPEN — ${this.failures.length} failures in ${this.windowMs / 1000}s window`
    );
  }

  _reset() {
    this.state = STATES.CLOSED;
    this.failures = [];
    this.openedAt = null;
    console.info(`[CircuitBreaker:${this.name}] CLOSED — circuit recovered`);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Execute `action`. If it throws, record the failure and possibly trip.
   * When OPEN, throw immediately so the caller can use a fallback.
   *
   * @param {() => Promise<any>} action  — the real work
   * @returns {Promise<any>}
   */
  async exec(action) {
    if (this.state === STATES.OPEN) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.recoveryTimeoutMs) {
        // Try a single probe call
        this.state = STATES.HALF_OPEN;
        console.info(`[CircuitBreaker:${this.name}] HALF_OPEN — probing real service`);
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await action();

      // Success — reset if we were probing
      if (this.state === STATES.HALF_OPEN) {
        this._reset();
      }
      return result;
    } catch (err) {
      // Don't count circuit-open errors as new failures
      if (err instanceof CircuitOpenError) throw err;

      const now = Date.now();
      this.failures.push(now);
      this._pruneOldFailures();

      console.warn(
        `[CircuitBreaker:${this.name}] failure recorded (${this.failures.length}/${this.failureThreshold}) — ${err.message}`
      );

      if (this.state === STATES.HALF_OPEN || this.failures.length >= this.failureThreshold) {
        this._trip();
      }

      throw err;
    }
  }

  getStatus() {
    this._pruneOldFailures();
    return {
      name: this.name,
      state: this.state,
      recentFailures: this.failures.length,
      failureThreshold: this.failureThreshold,
      windowMs: this.windowMs,
      openedAt: this.openedAt,
    };
  }
}

class CircuitOpenError extends Error {
  constructor(name) {
    super(`Circuit "${name}" is OPEN — request rejected`);
    this.name = 'CircuitOpenError';
    this.status = 503;
  }
}

module.exports = { CircuitBreaker, CircuitOpenError, STATES };
