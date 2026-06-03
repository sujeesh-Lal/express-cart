# Technical Documentation — Express Cart

This document explains the architecture, request lifecycle, folder responsibilities, data models, auth flow, and how to graduate from mocked data to a real database and Stripe.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Folder Responsibilities](#2-folder-responsibilities)
3. [Request Lifecycle](#3-request-lifecycle)
4. [Middleware Pipeline](#4-middleware-pipeline)
5. [Data Models](#5-data-models)
6. [Authentication & Authorization Flow](#6-authentication--authorization-flow)
7. [Core Business Flows](#7-core-business-flows)
   - [Register & Login](#71-register--login)
   - [Cart Operations](#72-cart-operations)
   - [Checkout (Cart → Order)](#73-checkout-cart--order)
   - [Payment Flow](#74-payment-flow)
8. [Error Handling Strategy](#8-error-handling-strategy)
9. [Validation Strategy](#9-validation-strategy)
10. [Replacing Mocks with Real Implementations](#10-replacing-mocks-with-real-implementations)

---

## 1. Architecture Overview

The project uses a **layered architecture** — each layer has a single, clearly scoped job. No layer reaches past its immediate neighbour.

```
HTTP Request
     │
     ▼
  Routes          (define URL patterns, attach middleware)
     │
     ▼
Middleware         (authenticate → authorize → validate)
     │
     ▼
Controllers        (parse req, call service, send res)
     │
     ▼
Services           (business logic, orchestration)
     │
     ▼
Repositories       (data access — currently in-memory)
     │
     ▼
Models             (data shape / class definitions)
```

This separation means:
- You can swap the database by changing only the repository files.
- You can swap business logic without touching HTTP handling.
- Tests can target a single layer without spinning up the whole server.

---

## 2. Folder Responsibilities

### `src/config/`
Reads environment variables once and exports a plain object. Every other file imports from here instead of reading `process.env` directly. This means if an env variable name changes, you fix it in one place.

### `src/models/`
Plain JavaScript classes that define the **shape** of each entity. They do not talk to any data store. Models can carry computed properties (e.g. `cart.total`, `cart.itemCount`) but no async logic.

### `src/repositories/`
The **only** layer that touches data storage. Right now that storage is in-memory JS arrays and Maps. Each repository exposes a clean interface (`findById`, `create`, `update`, `delete`) so the layer above never needs to know where data comes from.

When you introduce a database, you rewrite the repository functions to issue SQL/ORM queries. Nothing above them changes.

### `src/services/`
Where **business rules** live. Services orchestrate repositories, enforce constraints, and throw meaningful errors. Examples:
- `cartService.addItem` checks stock before adding.
- `orderService.checkout` validates every cart item, decrements stock, creates the order, then clears the cart — all as one logical unit.
- `authService` handles password hashing, JWT signing, and refresh token rotation.

Services never touch `req` or `res`. They are pure logic.

### `src/controllers/`
Thin HTTP adapters. Each controller method does exactly three things:
1. Pulls data out of `req` (body, params, query, `req.user`).
2. Calls the relevant service method.
3. Sends the response or passes errors to `next(err)`.

Controllers never contain business logic.

### `src/routes/`
Wire URL patterns to controller methods and attach any middleware required for that specific route. Route files are the place to look when you need to understand "what runs when I call `POST /cart/items`".

### `src/middleware/`

| File              | Responsibility |
|-------------------|----------------|
| `authenticate.js` | Reads the `Authorization` header, verifies the JWT, and attaches `req.user = { id, role }`. Rejects with 401 if missing or invalid. |
| `authorize.js`    | Checks `req.user.role` against the roles passed to it. Rejects with 403 if the role does not match. Must run after `authenticate`. |
| `validate.js`     | Checks `req.body` fields against a rule set. Returns 400 with field-level errors before the request reaches the controller. |
| `errorHandler.js` | Express's four-argument error handler. Reads `err.status` (default 500) and `err.message`, logs 500s to console, and sends a JSON error response. |

---

## 3. Request Lifecycle

Here is a complete trace of `POST /cart/items` (add item to cart):

```
1. express.json()
   └─ Parses JSON body → populates req.body

2. cartRoutes.js
   └─ router.post('/items', authenticate, validate(rules.addCartItem), cartController.addItem)

3. authenticate middleware
   └─ Reads Authorization header
   └─ Calls authService.verifyAccessToken(token)
   └─ Looks up user in userRepository
   └─ Attaches req.user = { id: 'uuid...', role: 'user' }

4. validate middleware
   └─ Checks req.body.productId (required, string)
   └─ Checks req.body.quantity (optional, number, min 1)
   └─ If errors → 400 { error: 'Validation failed', details: [...] }

5. cartController.addItem
   └─ Reads req.user.id and req.body
   └─ Calls cartService.addItem(userId, { productId, quantity })

6. cartService.addItem
   └─ productRepository.findById(productId) → checks existence and stock
   └─ cartRepository.getOrCreate(userId)
   └─ Adds or increments cart item
   └─ cartRepository.save(cart)
   └─ Returns updated cart

7. cartController
   └─ res.status(201).json({ id, items, total })

8. If any step throws → next(err) → errorHandler
   └─ Reads err.status and err.message
   └─ res.status(err.status).json({ error: err.message })
```

---

## 4. Middleware Pipeline

Middleware is applied at two levels:

**Router-level** (applies to every route in a file):
```js
// userRoutes.js
router.use(authenticate); // every user route requires auth
```

**Route-level** (applies to a specific route only):
```js
// productRoutes.js
router.post('/', authenticate, authorize('admin'), validate(rules.createProduct), productController.createProduct);
```

The order matters. `authenticate` must run before `authorize` because `authorize` reads `req.user`. `validate` should run before the controller to reject bad input early.

---

## 5. Data Models

### User
```
id            uuid
name          string
email         string (unique)
passwordHash  string (bcrypt, never exposed in responses)
role          'user' | 'admin'
createdAt     Date
updatedAt     Date
```
`user.toJSON()` strips `passwordHash` before the object is sent in any response.

### Product
```
id          uuid
name        string
description string
price       number (dollars)
stock       number (integer, decremented on checkout)
category    string
imageUrl    string
createdAt   Date
updatedAt   Date
```

### Cart
```
id        uuid
userId    uuid (one cart per user)
items     CartItem[]
updatedAt Date
```
Computed getters: `cart.total` (sum of item subtotals), `cart.itemCount` (total quantity).

### CartItem
```
productId    uuid
quantity     number
priceAtTime  number  ← price snapshotted when item was added
```
`priceAtTime` is used so that if a product's price changes, existing cart items retain the price from when they were added. This same value carries over to the order snapshot.

### Order
```
id               uuid
userId           uuid
items            snapshot array: [{ productId, name, quantity, priceAtTime }]
totalAmount      number
status           'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
paymentStatus    'unpaid' | 'paid' | 'refunded'
paymentIntentId  string | null  ← Stripe PI id
createdAt        Date
```
Order items are a **snapshot** — they record the product name and price at time of purchase so historical orders remain accurate even if a product is later edited or deleted.

---

## 6. Authentication & Authorization Flow

### Token Strategy
The API uses two tokens:

| Token         | Lifespan | Purpose                                      |
|---------------|----------|----------------------------------------------|
| Access token  | 15 min   | Sent with every protected request            |
| Refresh token | 7 days   | Used once to get a new access token; rotated |

### Login Flow
```
POST /auth/login
  → authService.login
    → find user by email
    → bcrypt.compare(password, passwordHash)
    → jwt.sign({ sub: userId, role }) → accessToken
    → jwt.sign({ sub: userId }) → refreshToken
    → store refreshToken in Set
    → return { accessToken, refreshToken, user }
```

### Refresh Token Rotation
When a client calls `POST /auth/refresh-token`:
1. Server checks the refresh token exists in the in-memory Set.
2. Verifies it hasn't expired with `jwt.verify`.
3. Deletes the old refresh token from the Set.
4. Issues a new access token AND a new refresh token.
5. Adds the new refresh token to the Set.

This means every refresh consumes the old token — stolen refresh tokens cannot be reused after the legitimate client has rotated them.

### authorize() Middleware
```js
authorize('admin')         // only admins
authorize('admin', 'user') // admins or regular users
```
`authorize` reads `req.user.role` which was attached by `authenticate`. If the role is not in the allowed list, it returns 403.

---

## 7. Core Business Flows

### 7.1 Register & Login

```
POST /auth/register
  body: { name, email, password }
  → validate middleware checks fields
  → authService.register
      → check email not already used
      → bcrypt.hash(password, 10)
      → userRepository.create(...)
  → 201 { message, user }

POST /auth/login
  body: { email, password }
  → authService.login
      → userRepository.findByEmail
      → bcrypt.compare
      → sign accessToken + refreshToken
  → 200 { accessToken, refreshToken, user }
```

### 7.2 Cart Operations

Each cart is owned by a single user and lives in memory under their `userId` key. The cart is created lazily on first access (`getOrCreate`).

```
POST /cart/items   { productId, quantity }
  → cartService.addItem
      → check product exists
      → check product.stock >= quantity
      → if item already in cart: increment quantity (re-check stock)
      → else: push new CartItem with priceAtTime = product.price
      → save cart

PUT /cart/items/:productId   { quantity: 0 }
  → quantity === 0 triggers removal, same as DELETE

DELETE /cart/items/:productId
  → filter out item from cart.items

DELETE /cart
  → cart.items = []
```

### 7.3 Checkout (Cart → Order)

`POST /orders` runs the full checkout sequence in one call:

```
1. Load cart for userId
2. Validate cart is not empty
3. For each cart item:
   a. Load product from repository
   b. Check product.stock >= item.quantity
   c. Build order item snapshot { productId, name, quantity, priceAtTime }
4. Deduct stock from every product (productRepository.decrementStock)
5. Calculate totalAmount
6. orderRepository.create({ userId, items, totalAmount, status: 'pending', paymentStatus: 'unpaid' })
7. cartRepository.clear(userId)
8. Return created order
```

If any stock check fails, the entire operation aborts — no stock is decremented and no order is created.

### 7.4 Payment Flow

```
POST /payments/checkout   { orderId }
  → find order, verify ownership
  → check order not already paid
  → [MOCK] create fake paymentIntent { id, client_secret, amount, currency }
  → save paymentIntentId on order
  → return paymentIntent to client

  [Client uses client_secret with Stripe.js to complete payment in browser]

POST /payments/webhook
  → [MOCK] simulates payment_intent.succeeded event
  → [REAL] stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  → find order by paymentIntentId
  → update order: paymentStatus = 'paid', status = 'processing'
  → return { received: true }
```

---

## 8. Error Handling Strategy

Errors are created inline and given a `status` property:

```js
throw Object.assign(new Error('Product not found'), { status: 404 });
```

Controllers catch errors from services and pass them to `next(err)`:

```js
async addItem(req, res, next) {
  try {
    const cart = cartService.addItem(...);
    res.json(cart);
  } catch (err) {
    next(err); // → errorHandler middleware
  }
}
```

`errorHandler.js` reads `err.status` (defaulting to 500) and sends:
```json
{ "error": "Product not found" }
```

500 errors are also logged to the console for debugging.

**Common status codes used:**

| Status | Meaning                                          |
|--------|--------------------------------------------------|
| 400    | Bad request — validation failure, empty cart, insufficient stock |
| 401    | Unauthenticated — missing/expired token          |
| 403    | Forbidden — wrong role or wrong owner            |
| 404    | Resource not found                               |
| 409    | Conflict — e.g. email already in use             |
| 500    | Unexpected server error                          |

---

## 9. Validation Strategy

`validate.js` is a middleware factory. You pass it an array of rules:

```js
router.post('/register', validate(validate.rules.register), authController.register);
```

Each rule can declare:

| Property   | Effect |
|------------|--------|
| `required` | Field must be present and non-empty |
| `type`     | `'string'` or `'number'` type check |
| `minLength`| Minimum string length |
| `min`      | Minimum numeric value |
| `isEmail`  | Basic email format check |

If any rule fails, `validate` returns a 400 immediately with the full list of errors — the controller is never called.

Pre-built rule sets live in `validate.rules` (register, login, createProduct, addCartItem, updateCartItem). Add new ones in `validate.js` as the API grows.

---

## 10. Replacing Mocks with Real Implementations

### Switching to a Database

Only the repository files need to change. Each repository method maps directly to a DB query:

| Repository method        | SQL equivalent                         |
|--------------------------|----------------------------------------|
| `findAll(filters)`       | `SELECT ... WHERE ... LIMIT ? OFFSET ?` |
| `findById(id)`           | `SELECT * FROM table WHERE id = ?`     |
| `findByEmail(email)`     | `SELECT * FROM users WHERE email = ?`  |
| `create(fields)`         | `INSERT INTO table (...) VALUES (...)`  |
| `update(id, fields)`     | `UPDATE table SET ... WHERE id = ?`    |
| `delete(id)`             | `DELETE FROM table WHERE id = ?`       |

Example — replacing `userRepository.findByEmail` with a Postgres query:

```js
// Before (mock)
findByEmail(email) {
  return users.find((u) => u.email === email) || null;
}

// After (with pg / knex / Prisma)
async findByEmail(email) {
  const row = await db('users').where({ email }).first();
  return row ? new User(row) : null;
}
```

Because services call `await repository.method()` consistently, making repository methods async requires no changes in the service layer.

### Switching to Real Stripe

In `paymentService.js`, replace the two mock blocks:

**createCheckout** — replace mock intent with real Stripe call:
```js
// Before
const mockPaymentIntent = { id: `pi_mock_${Date.now()}`, ... };

// After
const stripe = require('stripe')(config.stripe.secretKey);
const paymentIntent = await stripe.paymentIntents.create({
  amount: Math.round(order.totalAmount * 100),
  currency: 'usd',
  metadata: { orderId },
});
```

**handleWebhook** — verify the Stripe signature:
```js
// Before
const mockEvent = { type: 'payment_intent.succeeded', ... };

// After
const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
```

For the webhook to receive the raw body (not parsed JSON), mount the route before `express.json()` in `app.js` and use `express.raw({ type: 'application/json' })` for that route only:

```js
// app.js — before express.json()
app.use('/payments/webhook', express.raw({ type: 'application/json' }), paymentRoutes);

// then after
app.use(express.json());
app.use('/payments', paymentRoutes); // all other payment routes
```

### Refresh Token Storage

The in-memory `Set` in `authService.js` resets on every server restart. Replace it with a Redis `SET` or a `refresh_tokens` DB table:

```js
// Before
const refreshTokens = new Set();
refreshTokens.add(token);
refreshTokens.has(token);
refreshTokens.delete(token);

// After (Redis example)
await redis.set(token, userId, 'EX', 60 * 60 * 24 * 7); // 7 days TTL
await redis.exists(token);
await redis.del(token);
```
