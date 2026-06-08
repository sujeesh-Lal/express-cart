# GraphQL Guide — Express Cart

This document explains the GraphQL service added alongside the existing REST API, how it's structured, and how to use Queries, Mutations, and Subscriptions.

---

## Table of Contents

1. [Overview](#1-overview)
2. [How It Sits Alongside REST](#2-how-it-sits-alongside-rest)
3. [File Structure](#3-file-structure)
4. [The Schema (typeDefs)](#4-the-schema-typedefs)
5. [Resolvers](#5-resolvers)
6. [PubSub and Subscriptions](#6-pubsub-and-subscriptions)
7. [Authentication in GraphQL](#7-authentication-in-graphql)
8. [Using Apollo Studio (Sandbox)](#8-using-apollo-studio-sandbox)
9. [Queries — Examples](#9-queries--examples)
10. [Mutations — Examples](#10-mutations--examples)
11. [Subscriptions — Examples](#11-subscriptions--examples)
12. [Error Handling](#12-error-handling)
13. [How the GraphQL Server Boots](#13-how-the-graphql-server-boots)

---

## 1. Overview

The GraphQL service provides a second interface into the **products** domain. It runs at the same port as the REST API but on a different path:

| Interface         | Protocol  | URL                              |
|-------------------|-----------|----------------------------------|
| REST API          | HTTP      | `http://localhost:3000/...`      |
| GraphQL (queries/mutations) | HTTP | `http://localhost:3000/graphql` |
| GraphQL (subscriptions)     | WebSocket | `ws://localhost:3000/graphql`  |

Both interfaces share the same repositories and the same PostgreSQL database — they are two views of the same data, not two separate databases.

---

## 2. How It Sits Alongside REST

```
                          ┌──────────────────────────────┐
                          │         Express App           │
                          │                              │
  POST /auth/login  ──────│──► authRoutes                │
  GET  /products    ──────│──► productRoutes (REST)       │
  GET  /cart        ──────│──► cartRoutes                 │
                          │                              │
  POST /graphql     ──────│──► Apollo Server middleware   │
  WS   /graphql     ──────│──► graphql-ws WebSocket server│
                          └──────────┬───────────────────┘
                                     │
                                     ▼
                            productRepository
                                     │
                                     ▼
                               PostgreSQL DB
```

Both REST and GraphQL call the same `productRepository` functions. A product created via GraphQL is immediately visible via REST and vice versa.

---

## 3. File Structure

```
src/
└── graphql/
    ├── server.js      # Apollo Server setup + WebSocket subscription server
    ├── typeDefs.js    # GraphQL SDL — types, inputs, Query, Mutation, Subscription
    ├── resolvers.js   # Resolver functions for all operations
    └── pubsub.js      # Shared in-memory PubSub event bus
```

---

## 4. The Schema (typeDefs)

**Location:** `src/graphql/typeDefs.js`

The schema is written in **SDL (Schema Definition Language)** — a GraphQL-specific syntax that describes all available types and operations.

### Types

```graphql
type Product {
  id: ID!
  name: String!
  description: String!
  price: Float!
  stock: Int!
  category: String!
  imageUrl: String!
  createdAt: String!
  updatedAt: String!
}

type ProductList {
  data: [Product!]!
  total: Int!
  page: Int!
  limit: Int!
  totalPages: Int!
}
```

`!` means the field is non-nullable — the server guarantees it will never be null. `[Product!]!` means a non-null array of non-null Product objects.

### Inputs

Inputs are like types but used only as arguments to operations.

```graphql
input CreateProductInput {
  name: String!       # required
  description: String # optional
  price: Float!       # required
  stock: Int!         # required
  category: String    # optional
  imageUrl: String    # optional
}

input UpdateProductInput {
  name: String        # all fields optional on update
  description: String
  price: Float
  stock: Int
  category: String
  imageUrl: String
}

input ProductFiltersInput {
  search: String
  category: String
  minPrice: Float
  maxPrice: Float
  page: Int
  limit: Int
}
```

### Operations

```graphql
type Query {
  product(id: ID!): Product               # returns null if not found
  products(filters: ProductFiltersInput): ProductList!
}

type Mutation {
  createProduct(input: CreateProductInput!): Product!
  updateProduct(id: ID!, input: UpdateProductInput!): Product!
  deleteProduct(id: ID!): Boolean!
}

type Subscription {
  productCreated: Product!
  productUpdated: Product!
  productDeleted: ID!
}
```

---

## 5. Resolvers

**Location:** `src/graphql/resolvers.js`

Resolvers are the functions that execute when a GraphQL operation is called. Every field in `Query`, `Mutation`, and `Subscription` maps to a resolver function.

### Resolver function signature

```js
fieldName(parent, args, context, info)
```

| Argument  | What it contains |
|-----------|-----------------|
| `parent`  | The resolved value of the parent field (used for nested resolvers) |
| `args`    | Arguments passed in the operation (e.g. `{ id: "p-001" }`) |
| `context` | Shared object for every resolver in the request — contains `user` |
| `info`    | AST metadata about the query (rarely needed) |

### Example — Query resolver

```js
Query: {
  async product(_, { id }) {
    return productRepository.findById(id);
    // Returns null automatically if not found — GraphQL handles it
  },

  async products(_, { filters = {} }) {
    return productRepository.findAll(filters);
  },
}
```

### Example — Mutation resolver

```js
Mutation: {
  async createProduct(_, { input }, { user }) {
    requireAdmin(user);   // throws if not admin
    const product = await productRepository.create(input);
    pubsub.publish(EVENTS.PRODUCT_CREATED, { productCreated: product });
    return product;
  },
}
```

---

## 6. PubSub and Subscriptions

**Location:** `src/graphql/pubsub.js`

### What is PubSub?

PubSub (Publish-Subscribe) is an event bus. When something happens (e.g. a product is created), one part of the code **publishes** an event. Any client subscribed to that event **receives** it in real time over a WebSocket connection.

```
Mutation: createProduct
    │
    ├── saves to database
    └── pubsub.publish('PRODUCT_CREATED', { productCreated: product })
                           │
                           ▼
            All connected subscribers listening to
            productCreated receive the new product object
```

### How it's wired

**Publishing** (in the mutation resolver):
```js
pubsub.publish(EVENTS.PRODUCT_CREATED, { productCreated: product });
```

The object shape `{ productCreated: product }` must match the subscription field name — GraphQL uses it to resolve the subscription payload.

**Subscribing** (in the subscription resolver):
```js
Subscription: {
  productCreated: {
    subscribe: () => pubsub.asyncIterator([EVENTS.PRODUCT_CREATED]),
  },
}
```

`asyncIterator` returns an async iterator that yields a new value each time `publish` is called with that event name.

### WebSocket transport

Subscriptions run over WebSockets using the `graphql-ws` protocol. When a client opens a subscription:
1. A WebSocket connection is established to `ws://localhost:3000/graphql`.
2. The client sends a `subscribe` message with the subscription operation.
3. The server holds the connection open and sends new messages whenever `pubsub.publish` fires.
4. The client closes the connection when it unsubscribes or disconnects.

### Production note

The current `PubSub` is in-memory — events only reach subscribers on the **same server process**. If you run multiple server instances (e.g. horizontally scaled), use `graphql-redis-subscriptions`:

```js
const { RedisPubSub } = require('graphql-redis-subscriptions');
const pubsub = new RedisPubSub({ connection: { host: 'localhost', port: 6379 } });
```

The rest of the code stays exactly the same.

---

## 7. Authentication in GraphQL

GraphQL does not have built-in auth — it is handled in the **context** and **resolvers**.

### How context works

For every HTTP request, `server.js` reads the `Authorization` header, verifies the JWT, and attaches the user to `context`:

```js
// src/graphql/server.js
context: async ({ req }) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromToken(token);
  return { user };   // ← available in every resolver as context.user
}
```

For WebSocket subscriptions, the JWT is passed in `connectionParams`:
```json
{ "authorization": "Bearer eyJhbGciOi..." }
```

### How resolvers check auth

```js
function requireAdmin(user) {
  if (!user) throw gqlError('Unauthenticated', 'UNAUTHENTICATED', 401);
  if (user.role !== 'admin') throw gqlError('Forbidden', 'FORBIDDEN', 403);
}

// Used inside any mutation that requires admin:
async createProduct(_, { input }, { user }) {
  requireAdmin(user);
  // ...
}
```

Queries (`product`, `products`) are public — they do not call `requireAdmin`.

---

## 8. Using Apollo Studio (Sandbox)

Apollo Server v4 automatically serves a built-in **Apollo Sandbox** in development mode. Open your browser to:

```
http://localhost:3000/graphql
```

You'll see an interactive IDE where you can:
- Browse the schema and all available operations
- Write and run queries, mutations, and subscriptions
- Add headers (for auth tokens)

**Adding auth in Apollo Studio:**
1. Click **Headers** tab at the bottom
2. Add: `{ "Authorization": "Bearer <your_access_token>" }`
3. Get an access token first by calling `POST /auth/login` via the REST API

---

## 9. Queries — Examples

### Get a single product

```graphql
query GetProduct {
  product(id: "p-001") {
    id
    name
    price
    stock
    category
  }
}
```

**Response:**
```json
{
  "data": {
    "product": {
      "id": "p-001",
      "name": "Wireless Mouse",
      "price": 29.99,
      "stock": 50,
      "category": "Electronics"
    }
  }
}
```

If the product doesn't exist, `data.product` will be `null`.

---

### List all products

```graphql
query ListProducts {
  products {
    data {
      id
      name
      price
      stock
    }
    total
    page
    totalPages
  }
}
```

---

### List with filters and pagination

```graphql
query SearchProducts {
  products(filters: {
    search: "keyboard"
    category: "Electronics"
    minPrice: 20
    maxPrice: 100
    page: 1
    limit: 5
  }) {
    data {
      id
      name
      price
      stock
    }
    total
    page
    limit
    totalPages
  }
}
```

---

### Using variables (recommended over inline values)

```graphql
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    name
    price
    stock
  }
}
```

Variables panel:
```json
{ "id": "p-001" }
```

---

## 10. Mutations — Examples

All mutations require an admin JWT. Add `Authorization: Bearer <token>` to headers.

### Create a product

```graphql
mutation CreateProduct($input: CreateProductInput!) {
  createProduct(input: $input) {
    id
    name
    price
    stock
    category
    createdAt
  }
}
```

Variables:
```json
{
  "input": {
    "name": "Monitor Stand",
    "description": "Adjustable aluminium monitor stand",
    "price": 59.99,
    "stock": 25,
    "category": "Office"
  }
}
```

---

### Update a product

```graphql
mutation UpdateProduct($id: ID!, $input: UpdateProductInput!) {
  updateProduct(id: $id, input: $input) {
    id
    name
    price
    stock
    updatedAt
  }
}
```

Variables:
```json
{
  "id": "p-001",
  "input": {
    "price": 24.99,
    "stock": 45
  }
}
```

Only the fields you include in `input` are updated — omitted fields stay as they are.

---

### Delete a product

```graphql
mutation DeleteProduct($id: ID!) {
  deleteProduct(id: $id)
}
```

Variables:
```json
{ "id": "p-001" }
```

Returns `true` on success. If the product doesn't exist, returns a `NOT_FOUND` error.

---

## 11. Subscriptions — Examples

Subscriptions run over WebSocket. You can test them directly in Apollo Studio — open a second browser tab while running a mutation in the first.

### Subscribe to new products

```graphql
subscription OnProductCreated {
  productCreated {
    id
    name
    price
    category
  }
}
```

Leave this running. Every time `createProduct` is called (via GraphQL or REST — if you fire the event), this subscription receives the new product in real time.

---

### Subscribe to product updates

```graphql
subscription OnProductUpdated {
  productUpdated {
    id
    name
    price
    stock
    updatedAt
  }
}
```

---

### Subscribe to product deletions

```graphql
subscription OnProductDeleted {
  productDeleted
}
```

Returns the deleted product's ID (a string) each time a deletion occurs.

---

### Subscription with auth (WebSocket connectionParams)

When using a WebSocket client directly (e.g. `graphql-ws` in a frontend app):

```js
import { createClient } from 'graphql-ws';

const client = createClient({
  url: 'ws://localhost:3000/graphql',
  connectionParams: {
    authorization: 'Bearer <your_access_token>',
  },
});
```

In Apollo Studio, add the connection param under **Connection Settings** before starting the subscription.

---

## 12. Error Handling

GraphQL errors are returned with HTTP 200 but include an `errors` array in the response:

```json
{
  "errors": [
    {
      "message": "Forbidden",
      "extensions": {
        "code": "FORBIDDEN",
        "http": { "status": 403 }
      }
    }
  ],
  "data": null
}
```

### Error codes used

| code              | Meaning                                    |
|-------------------|--------------------------------------------|
| `UNAUTHENTICATED` | No token or invalid token                  |
| `FORBIDDEN`       | Valid token but not admin role             |
| `NOT_FOUND`       | Product ID does not exist                  |
| `INTERNAL_SERVER_ERROR` | Unhandled server error              |

---

## 13. How the GraphQL Server Boots

`src/graphql/server.js` exports `applyGraphQL(app, httpServer)`. Here's what it does step by step:

```
1. makeExecutableSchema({ typeDefs, resolvers })
   └─ Combines SDL and resolver functions into a single executable schema

2. new WebSocketServer({ server: httpServer, path: '/graphql' })
   └─ Attaches a WebSocket server to the existing Node http.Server
   └─ All WS traffic to /graphql goes here

3. useServer({ schema }, wsServer)
   └─ Wires graphql-ws protocol handling onto the WebSocket server
   └─ Returns a cleanup handle used on graceful shutdown

4. new ApolloServer({ schema, plugins: [...] })
   └─ Creates the Apollo Server instance
   └─ ApolloServerPluginDrainHttpServer — waits for in-flight HTTP requests on shutdown
   └─ Custom plugin — calls wsServerCleanup.dispose() on shutdown

5. await apolloServer.start()
   └─ Apollo Server v4 requires explicit start() before middleware is mounted

6. app.use('/graphql', expressMiddleware(apolloServer, { context }))
   └─ Mounts Apollo as standard Express middleware at /graphql
   └─ Every request runs the context function to extract req.user
```

`app.js` calls `applyGraphQL(app, httpServer)` inside an async `start()` function before `httpServer.listen()`, ensuring Apollo is fully ready before accepting connections.
