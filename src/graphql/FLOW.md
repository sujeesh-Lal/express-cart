# GraphQL Module — Control Flow

## File Layout

```
src/graphql/
├── typeDefs.js   — Schema: types, inputs, Query, Mutation, Subscription
├── resolvers.js  — Business logic for each operation
├── pubsub.js     — In-memory event bus for subscriptions
└── server.js     — Wires Apollo + WebSocket onto the Express app
```

---

## Boot Sequence (app.js → server.js)

```
app.js
  └─ http.createServer(expressApp)       ← single http.Server shared by REST + GraphQL
  └─ applyGraphQL(app, httpServer)       ← called before 404/errorHandler
       ├─ makeExecutableSchema()         ← merges typeDefs + resolvers into one schema
       ├─ new WebSocketServer()          ← attaches to the same httpServer on path /graphql
       ├─ useServer(schema, wsServer)    ← graphql-ws handles WS subscription protocol
       ├─ new ApolloServer(schema)       ← HTTP Query/Mutation handler
       ├─ apolloServer.start()
       └─ app.use('/graphql', expressMiddleware(apolloServer, { context }))
  └─ httpServer.listen(port)
```

Both HTTP and WebSocket traffic land on the same port and path (`/graphql`).
Node's `http.Server` upgrades WebSocket handshakes automatically; everything
else goes to Apollo's Express middleware.

---

## HTTP Request Flow (Query / Mutation)

```
Client  →  POST /graphql  { query, variables }
            │
            ▼
   Express middleware (express.json)         ← parses JSON body
            │
            ▼
   Apollo expressMiddleware
     context()  ─── reads Authorization header
                ─── strips "Bearer ", calls getUserFromToken()
                       └─ authService.verifyAccessToken(token)  ← verifies JWT
                       └─ userRepository.findById(payload.sub)  ← loads DB user
                ─── attaches { user } to context (null if no/invalid token)
            │
            ▼
   Schema execution  →  routes operation to the matching resolver
            │
   ┌────────┴──────────────────────────────────────────────┐
   │  Query            │  Mutation                          │
   │  (public)         │  (admin only)                      │
   │                   │                                    │
   │  product(id)  ──► │  requireAdmin(ctx.user)            │
   │    productRepo    │    throws 401 / 403 if not admin   │
   │    .findById()    │                                    │
   │                   │  productRepo.create/update/delete()│
   │  products(filters)│    ── on success ──►               │
   │    productRepo    │    pubsub.publish(EVENT, payload)  │
   │    .findAll()     │    returns result to client        │
   └───────────────────┴────────────────────────────────────┘
            │
            ▼
   Apollo serialises result  →  { data: {...} }  or  { errors: [...] }
            │
            ▼
         Client
```

---

## WebSocket Flow (Subscription)

```
Client  →  ws://host/graphql   (WebSocket upgrade)
            │
            ▼
   graphql-ws / useServer
     context()  ─── reads connectionParams.authorization
                ─── same getUserFromToken() as HTTP path
                ─── attaches { user } to WS context
            │
            ▼
   Client sends: { type: "subscribe", payload: { query: "subscription { productCreated { ... } }" } }
            │
            ▼
   Subscription resolver
     subscribe()  →  pubsub.asyncIterator([EVENTS.PRODUCT_CREATED])
                      ← returns an async iterator that yields on each publish
            │
            ▼
   Mutation fires  →  pubsub.publish(EVENTS.PRODUCT_CREATED, { productCreated: product })
            │
            ▼
   PubSub broadcasts to all active iterators for that event
            │
            ▼
   graphql-ws pushes  { type: "next", payload: { data: { productCreated: {...} } } }
            │
            ▼
         Client receives real-time push
```

---

## Auth Model

| Operation         | Auth required | Check              |
|-------------------|---------------|--------------------|
| `product`         | No            | —                  |
| `products`        | No            | —                  |
| `createProduct`   | Yes — admin   | `requireAdmin(ctx.user)` |
| `updateProduct`   | Yes — admin   | `requireAdmin(ctx.user)` |
| `deleteProduct`   | Yes — admin   | `requireAdmin(ctx.user)` |
| Subscriptions     | No            | open to any WS client |

`requireAdmin` checks `ctx.user` (populated in context) — throws `UNAUTHENTICATED (401)` if
missing, `FORBIDDEN (403)` if the role is not `admin`.

---

## PubSub (Event Bus)

```
pubsub.js exports:
  pubsub   — PubSub instance (in-memory, single-process)
  EVENTS   — { PRODUCT_CREATED, PRODUCT_UPDATED, PRODUCT_DELETED }

Mutation resolvers       →  pubsub.publish(EVENT, payload)
Subscription resolvers   ←  pubsub.asyncIterator([EVENT])
```

> **Production note:** `PubSub` is in-memory and scoped to one Node process.
> For multi-instance deployments replace it with `RedisPubSub` from
> `graphql-redis-subscriptions` so events are shared across all nodes.

---

## Graceful Shutdown

On `SIGINT` / `SIGTERM`:

1. `httpServer.close()` — stops accepting new HTTP/WS connections
2. Apollo's `ApolloServerPluginDrainHttpServer` drains in-flight HTTP requests
3. The custom plugin calls `wsServerCleanup.dispose()` — closes all active WebSocket subscriptions cleanly
4. `prisma.$disconnect()` — closes the DB connection pool
