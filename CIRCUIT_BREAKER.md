# Circuit Breaker Pattern — List Products API

## Overview

The Circuit Breaker pattern prevents cascading failures when the product database becomes unavailable. Instead of hammering a broken service, the breaker tracks recent failures and once a threshold is exceeded it "opens" the circuit — automatically routing all calls to a mock service that returns static placeholder data.

This keeps `GET /products` responsive to users during a database outage while giving the real service time to recover.

---

## Affected Files

| File | Role |
|------|------|
| `src/utils/circuitBreaker.js` | Core state machine: CLOSED / OPEN / HALF_OPEN logic |
| `src/services/mockProductService.js` | Fallback: returns static mock products |
| `src/services/productService.js` | Wraps `listProducts()` with the circuit breaker |

---

## State Machine

```
               failures >= threshold (within 30 s)
  ┌────────────────────────────────────────────────────────────┐
  │                                                            │
  ▼                                                            │
┌────────┐   success                  ┌──────────┐            │
│        │ ◄─────────────────────────  │          │            │
│ CLOSED │                             │ HALF_OPEN│ ◄─ 60 s ──┤
│        │──── failures >= 3 ─────────►│          │            │
└────────┘                             └──────────┘            │
                                            │                  │
                                          fail                 │
                                            │                  │
                                       ┌────▼───┐             │
                                       │        │             │
                                       │  OPEN  │────────────►┘
                                       │        │   recoveryTimeout elapsed
                                       └────────┘
```

### CLOSED — normal operation
All requests flow through to the real database. Each failure is timestamped in a rolling 30-second window; failures older than the window are pruned before each check.

- Request **succeeds** → stays CLOSED
- Request **fails** → failure recorded; if count >= `failureThreshold` (3) → transitions to **OPEN**

### OPEN — tripped
The real service is assumed broken. `exec()` throws `CircuitOpenError` immediately without touching the database. `productService` catches this and returns mock data.

- Stays OPEN for `recoveryTimeoutMs` (60 s)
- After timeout → transitions to **HALF_OPEN** on the next request

### HALF_OPEN — recovery probe
One trial request is allowed through to test if the database has recovered.

- Trial **succeeds** → failure list cleared, transitions back to **CLOSED**
- Trial **fails** → immediately back to **OPEN**

---

## End-to-End Request Flow

```
Client
  │
  │  GET /products?page=1&limit=10
  ▼
productRoutes.js
  │  router.get('/', productController.listProducts)
  ▼
productController.js
  │  productService.listProducts(req.query)
  ▼
productService.js
  │
  ├─ productListCircuitBreaker.exec(() => productRepository.findAll(query))
  │
  │   ┌─────────────────────────────────────────────────────────────┐
  │   │                  CircuitBreaker.exec()                      │
  │   │                                                             │
  │   │  state == OPEN && timeout not elapsed?                      │
  │   │    └─► throw CircuitOpenError  ──────────────────────────┐  │
  │   │                                                          │  │
  │   │  state == OPEN && timeout elapsed?                       │  │
  │   │    └─► state = HALF_OPEN, run probe                      │  │
  │   │                                                          │  │
  │   │  state == CLOSED / HALF_OPEN?                            │  │
  │   │    └─► await productRepository.findAll(query)            │  │
  │   │            │                        │                    │  │
  │   │          success                  failure                │  │
  │   │            │                        │                    │  │
  │   │    if HALF_OPEN → CLOSED     record failure              │  │
  │   │    return result             if count >= threshold        │  │
  │   │                                → OPEN, re-throw          │  │
  │   └─────────────────────────────────────────────────────────┘  │
  │                                          ◄─────────────────────┘
  │   catch (CircuitOpenError | state==OPEN)
  │     └─► mockProductService.listProducts(query)
  │
  ▼
productController.js
  │  res.json(result)
  ▼
Client  ← 200 OK (real data, or mock data with isMockData: true)
```

---

## Key Code

### `CircuitBreaker.exec()` — core logic

```js
async exec(action) {
  if (this.state === STATES.OPEN) {
    const elapsed = Date.now() - this.openedAt;
    if (elapsed >= this.recoveryTimeoutMs) {
      this.state = STATES.HALF_OPEN;      // allow one probe
    } else {
      throw new CircuitOpenError(this.name); // fast-fail
    }
  }

  try {
    const result = await action();
    if (this.state === STATES.HALF_OPEN) this._reset(); // recovered!
    return result;
  } catch (err) {
    this.failures.push(Date.now());
    this._pruneOldFailures();
    if (this.state === STATES.HALF_OPEN || this.failures.length >= this.failureThreshold) {
      this._trip(); // open the circuit
    }
    throw err;
  }
}
```

### `productService.listProducts()` — wired fallback

```js
async listProducts(query) {
  try {
    return await productListCircuitBreaker.exec(() =>
      productRepository.findAll(query)
    );
  } catch (err) {
    if (err instanceof CircuitOpenError ||
        productListCircuitBreaker.getStatus().state !== 'CLOSED') {
      return mockProductService.listProducts(query); // fallback
    }
    throw err;
  }
}
```

### Mock response shape

```js
{
  data: [ /* 3 placeholder products */ ],
  total: 3,
  page: 1,
  limit: 10,
  totalPages: 1,
  isMockData: true   // ← signals fallback to the client
}
```

---

## Configuration

Tuning knobs in `src/services/productService.js`:

```js
const productListCircuitBreaker = new CircuitBreaker('product-list', {
  failureThreshold:  3,        // failures before tripping
  windowMs:          30_000,   // 30-second rolling failure window
  recoveryTimeoutMs: 60_000,   // stay OPEN for 60 s before probing
});
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `failureThreshold` | `3` | Number of failures within `windowMs` that trips the circuit |
| `windowMs` | `30000` | Rolling window (ms) for counting failures; older failures are ignored |
| `recoveryTimeoutMs` | `60000` | How long to stay OPEN before attempting a HALF_OPEN probe |

---

## Observability

The breaker logs on every state change:

```
[CircuitBreaker:product-list] failure recorded (2/3) — <error message>
[CircuitBreaker:product-list] OPEN — 3 failures in 30s window
[CircuitBreaker:product-list] HALF_OPEN — probing real service
[CircuitBreaker:product-list] CLOSED — circuit recovered
```

Runtime status is available programmatically:

```js
productListCircuitBreaker.getStatus();
// { name, state, recentFailures, failureThreshold, windowMs, openedAt }
```

> **Tip:** expose `getStatus()` on an internal health-check route (e.g. `GET /health/circuit-breakers`) so your monitoring stack can track state without log parsing.

---

## Scope & Limitations

- Only `listProducts` (`GET /products`) is protected. `getProduct`, `createProduct`, `updateProduct`, and `deleteProduct` call the repository directly.
- Circuit state is in-process memory — a process restart resets it to CLOSED regardless of DB health.
- In a multi-process deployment (cluster, multiple pods), each process maintains its own independent state.
- The mock service only supports pagination; `search`, `category`, and price filters from the query string are ignored.
