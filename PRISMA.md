# Prisma Guide — Express Cart

This document explains what Prisma is, how it works, how it's wired into this project, and what every Prisma-related file does.

---

## Table of Contents

1. [What is Prisma?](#1-what-is-prisma)
2. [How Prisma Works (the three layers)](#2-how-prisma-works-the-three-layers)
3. [Prisma Files in This Project](#3-prisma-files-in-this-project)
4. [The Schema File](#4-the-schema-file)
5. [Migrations](#5-migrations)
6. [The Seed File](#6-the-seed-file)
7. [The Prisma Client](#7-the-prisma-client)
8. [How Repositories Use Prisma](#8-how-repositories-use-prisma)
9. [Common Prisma Queries](#9-common-prisma-queries)
10. [Prisma CLI Cheat Sheet](#10-prisma-cli-cheat-sheet)
11. [Workflow: Making a Schema Change](#11-workflow-making-a-schema-change)

---

## 1. What is Prisma?

Prisma is an **ORM (Object-Relational Mapper)** for Node.js. It sits between your application code and the database, so instead of writing raw SQL like this:

```sql
SELECT * FROM "User" WHERE email = 'jane@example.com';
```

You write JavaScript like this:

```js
prisma.user.findUnique({ where: { email: 'jane@example.com' } });
```

Prisma translates that JavaScript into the correct SQL, runs it against the database, and returns a plain JavaScript object you can use directly.

**Why use Prisma over raw SQL or other ORMs?**

- **Type-safe** — your editor knows the shape of every query result.
- **Auto-completion** — `prisma.user.` shows you every available field and method.
- **Migrations** — schema changes are tracked in version-controlled files, not applied manually.
- **Readable** — queries read almost like plain English.
- **One schema file** — your database structure is defined in one place, not scattered across multiple model files.

---

## 2. How Prisma Works (the three layers)

```
┌─────────────────────────────────────┐
│         Your Application Code       │
│     (repositories, services)        │
└──────────────────┬──────────────────┘
                   │  JavaScript method calls
                   ▼
┌─────────────────────────────────────┐
│           Prisma Client             │
│   (auto-generated from schema)      │
│                                     │
│  prisma.user.findUnique(...)        │
│  prisma.product.findMany(...)       │
└──────────────────┬──────────────────┘
                   │  SQL queries
                   ▼
┌─────────────────────────────────────┐
│           PostgreSQL                │
│    (running in Docker locally)      │
└─────────────────────────────────────┘
```

The three core parts of Prisma are:

**1. Prisma Schema (`prisma/schema.prisma`)**
The single source of truth for your database structure. You define models (tables), fields (columns), relations, and enums here.

**2. Prisma Migrate**
A CLI tool that reads your schema and generates SQL migration files. When you change the schema, you run a migration command and Prisma creates the SQL to update the database.

**3. Prisma Client (`@prisma/client`)**
A JavaScript library that is auto-generated from your schema. It gives you a fully type-aware API to query your database. Every time you change the schema you regenerate the client.

---

## 3. Prisma Files in This Project

```
express-cart/
├── prisma/
│   ├── schema.prisma          # Database schema — models, enums, relations
│   ├── seed.js                # Script to insert initial data
│   └── migrations/            # Auto-generated SQL migration history
│       └── 20240101_init/
│           └── migration.sql  # The SQL Prisma created for your schema
└── src/
    └── config/
        └── prismaClient.js    # Shared PrismaClient instance used by repositories
```

---

## 4. The Schema File

**Location:** `prisma/schema.prisma`

This is the most important Prisma file. It defines three things:

### 4a. Generator and Datasource (top of the file)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- `generator client` — tells Prisma to generate a JavaScript client.
- `datasource db` — tells Prisma which database to connect to. The `env("DATABASE_URL")` reads the connection string from your `.env` file.

### 4b. Enums

```prisma
enum Role {
  user
  admin
}

enum OrderStatus {
  pending
  processing
  shipped
  delivered
  cancelled
}

enum PaymentStatus {
  unpaid
  paid
  refunded
}
```

Enums are sets of fixed allowed values for a field. PostgreSQL enforces these at the database level — you cannot insert an invalid status even if you bypass your application code.

### 4c. Models (Tables)

Each `model` block becomes a database table.

```prisma
model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  role         Role     @default(user)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  cart   Cart?
  orders Order[]
}
```

**Field attributes explained:**

| Attribute           | Meaning                                                  |
|---------------------|----------------------------------------------------------|
| `@id`               | This field is the primary key                            |
| `@default(uuid())`  | Auto-generate a UUID when a row is inserted              |
| `@default(now())`   | Set the current timestamp on insert                      |
| `@updatedAt`        | Prisma automatically updates this on every update        |
| `@unique`           | Enforce uniqueness at the database level                 |
| `@default(user)`    | Default enum value                                       |
| `Cart?`             | Optional relation — a user may or may not have a cart    |
| `Order[]`           | Array relation — a user can have many orders             |

### 4d. Relations

Relations link models together. Prisma uses two sides to describe every relation.

**One-to-one** (User ↔ Cart — each user has one cart):
```prisma
model User {
  cart Cart?         // User side — optional, user may have no cart yet
}

model Cart {
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**One-to-many** (User → Orders — one user, many orders):
```prisma
model User {
  orders Order[]     // User side — array of orders
}

model Order {
  userId String
  user   User  @relation(fields: [userId], references: [id])
}
```

`fields: [userId]` is the foreign key column in the Order table. `references: [id]` is the column it points to in User.

`onDelete: Cascade` means if a User is deleted, their Cart and CartItems are automatically deleted too.

**Compound unique constraint** (CartItem — one row per product per cart):
```prisma
model CartItem {
  cartId    String
  productId String

  @@unique([cartId, productId])  // combination must be unique
}
```

This is what allows the cart repository to `upsert` — add if not exists, update if it does.

---

## 5. Migrations

### What is a migration?

A migration is a SQL file that describes a change to your database schema. Migrations are:

- **Version-controlled** — stored in `prisma/migrations/`, committed to git.
- **Ordered** — each migration has a timestamp prefix so they always run in the correct order.
- **Cumulative** — Prisma tracks which migrations have already been applied so it never runs the same one twice.

### Migration folder structure

```
prisma/migrations/
└── 20240615120000_init/
    └── migration.sql        ← the actual SQL Prisma generated
```

The folder name is: `{timestamp}_{name_you_gave_it}`.

### migration.sql

This file is auto-generated by Prisma — you should never edit it manually. It contains the raw SQL that creates your tables. Example excerpt:

```sql
CREATE TYPE "Role" AS ENUM ('user', 'admin');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE ("email");
```

### _prisma_migrations table

Prisma creates a special table called `_prisma_migrations` in your database. It records every migration that has been applied so Prisma knows not to run them again. You can see this table in DBeaver.

### Migration commands

**Create and apply a new migration** (use this when you change the schema):
```bash
npm run db:migrate
# or directly:
npx prisma migrate dev --name describe_your_change
```
Prisma compares your current schema against the database state, generates the SQL diff, saves it as a migration file, and applies it.

**Apply existing migrations without creating new ones** (use this on a fresh machine or in CI/CD):
```bash
npx prisma migrate deploy
```

**Push schema directly without creating migration files** (useful for quick experiments — do not use in production):
```bash
npm run db:push
```

**Reset the database** (drops everything, re-runs all migrations, re-seeds):
```bash
npx prisma migrate reset
```

---

## 6. The Seed File

**Location:** `prisma/seed.js`

A seed file populates the database with initial data — typically the records needed to make the app usable from the start. In this project that means one admin user and five sample products.

```js
// prisma/seed.js (simplified)
const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.create({
    data: { name: 'Admin', email: 'admin@example.com', passwordHash, role: 'admin' },
  });

  await prisma.product.create({
    data: { name: 'Wireless Mouse', price: 29.99, stock: 50, category: 'Electronics' },
  });
}

main().finally(() => prisma.$disconnect());
```

**Run the seed:**
```bash
npm run db:seed
```

The seed script checks before inserting — if the admin user or a product already exists it skips that record, so it is safe to run multiple times.

**When to run the seed:**
- After `db:migrate` on a fresh database.
- After `prisma migrate reset` (which wipes and re-migrates).
- Never in production for user-facing data — only for required reference data (e.g. admin accounts, config records).

---

## 7. The Prisma Client

**Location:** `src/config/prismaClient.js`

```js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

module.exports = prisma;
```

**Why a singleton?**

`PrismaClient` manages a connection pool to the database. Creating a new instance every time a request comes in would open a new pool on each request, quickly exhausting available database connections. By creating one instance and sharing it across the whole application, all requests share the same pool efficiently.

**The generated client (`@prisma/client`)**

The `@prisma/client` package is a shell — it does not contain the actual query engine until you run `prisma generate`. That command reads `schema.prisma` and writes the generated code into `node_modules/@prisma/client`. This is why `prisma generate` must be run after `npm install` on a fresh machine, and after every schema change.

`npm run db:migrate` runs `prisma generate` automatically, so in practice you rarely need to call it manually.

---

## 8. How Repositories Use Prisma

Repositories are the only files that import and call `prisma`. No service or controller touches `prisma` directly — except `orderService.checkout`, which uses `prisma.$transaction`.

### Basic CRUD

```js
// userRepository.js
const prisma = require('../config/prismaClient');

// READ one
prisma.user.findUnique({ where: { id } })

// READ many
prisma.user.findMany({ orderBy: { createdAt: 'desc' } })

// CREATE
prisma.user.create({ data: { name, email, passwordHash } })

// UPDATE
prisma.user.update({ where: { id }, data: { name } })

// DELETE
prisma.user.delete({ where: { id } })
```

### Including related data

```js
// cartRepository.js — fetch cart AND its items AND each item's product
prisma.cart.findUnique({
  where: { userId },
  include: {
    items: {
      include: { product: true }
    }
  }
})
```

Without `include`, relations are not fetched. You only pay for what you ask for.

### Upsert (create or update)

```js
// cartRepository.js — add item if not in cart, update quantity if it is
prisma.cartItem.upsert({
  where: { cartId_productId: { cartId, productId } },  // compound unique key
  create: { cartId, productId, quantity, priceAtTime },
  update: { quantity, priceAtTime },
})
```

### Transactions

Used in `orderService.checkout` to make the entire checkout operation atomic — if any step fails, every database change in that block is rolled back automatically.

```js
const order = await prisma.$transaction(async (tx) => {
  // All operations use `tx` instead of `prisma` inside here.
  // If any line throws, ALL changes are rolled back.

  await tx.product.update({ ... });   // decrement stock
  const order = await tx.order.create({ ... });  // create order
  await tx.cartItem.deleteMany({ ... });  // clear cart

  return order;
});
```

### Atomic increment / decrement

```js
// Decrement stock without a race condition
prisma.product.update({
  where: { id },
  data: { stock: { decrement: quantity } },
})
```

This translates to `UPDATE "Product" SET stock = stock - 2 WHERE id = ?` — the subtraction happens inside the database in a single operation, not read-modify-write in JavaScript.

---

## 9. Common Prisma Queries

### Filtering

```js
// Exact match
prisma.product.findMany({ where: { category: 'Electronics' } })

// Case-insensitive contains (like SQL ILIKE '%keyboard%')
prisma.product.findMany({
  where: { name: { contains: 'keyboard', mode: 'insensitive' } }
})

// Range
prisma.product.findMany({
  where: { price: { gte: 10, lte: 50 } }  // >= 10 AND <= 50
})

// OR condition
prisma.product.findMany({
  where: {
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }
})
```

### Pagination

```js
prisma.product.findMany({
  skip: (page - 1) * limit,   // offset
  take: limit,                 // how many rows
  orderBy: { createdAt: 'desc' }
})
```

### Count

```js
prisma.product.count({ where: { category: 'Electronics' } })
```

### Parallel queries

```js
// Run two queries at the same time instead of waiting for each
const [data, total] = await Promise.all([
  prisma.product.findMany({ where, skip, take }),
  prisma.product.count({ where }),
]);
```

### Nested create (order + items in one query)

```js
prisma.order.create({
  data: {
    userId,
    totalAmount,
    items: {
      create: [
        { productId: 'p-001', name: 'Mouse', quantity: 2, priceAtTime: 29.99 },
        { productId: 'p-002', name: 'Keyboard', quantity: 1, priceAtTime: 89.99 },
      ]
    }
  },
  include: { items: true }
})
```

### Handle "not found" errors

Prisma throws a `P2025` error when you call `update` or `delete` on a record that does not exist. Catch it in the service layer:

```js
try {
  return await prisma.product.update({ where: { id }, data: fields });
} catch (err) {
  if (err.code === 'P2025') {
    throw Object.assign(new Error('Product not found'), { status: 404 });
  }
  throw err;
}
```

---

## 10. Prisma CLI Cheat Sheet

| Command                                      | What it does                                              |
|----------------------------------------------|-----------------------------------------------------------|
| `npx prisma migrate dev --name <label>`      | Create + apply a new migration (development only)         |
| `npx prisma migrate deploy`                  | Apply pending migrations (production / CI)                |
| `npx prisma migrate reset`                   | Drop DB, re-run all migrations, re-seed                   |
| `npx prisma migrate status`                  | Show which migrations have been applied                   |
| `npx prisma db push`                         | Sync schema to DB without a migration file (prototyping)  |
| `npx prisma db seed`                         | Run the seed script                                       |
| `npx prisma generate`                        | Regenerate Prisma Client from schema                      |
| `npx prisma studio`                          | Open visual database browser at localhost:5555            |
| `npx prisma format`                          | Auto-format schema.prisma                                 |
| `npx prisma validate`                        | Check schema.prisma for errors                            |

---

## 11. Workflow: Making a Schema Change

Here is the exact sequence to follow every time you need to change the database structure.

**Example: add a `phone` field to User.**

**Step 1 — Edit `prisma/schema.prisma`:**
```prisma
model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  phone        String?  // ← add this (? means optional/nullable)
  role         Role     @default(user)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

**Step 2 — Create and apply the migration:**
```bash
npx prisma migrate dev --name add_phone_to_user
```

Prisma will:
- Generate `prisma/migrations/20240616_add_phone_to_user/migration.sql`
- Run `ALTER TABLE "User" ADD COLUMN "phone" TEXT;` against your database
- Regenerate the Prisma Client

**Step 3 — Use the new field in code:**

The Prisma Client is now aware of `phone`. You can immediately use it:
```js
prisma.user.update({ where: { id }, data: { phone: '+1234567890' } })
```

**Step 4 — Commit everything:**
```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "add phone field to User"
```

Migration files must be committed to git. They are how other developers (and your production server) know what changes to apply.

**When another developer pulls your changes:**
```bash
npm install           # in case package.json changed
npx prisma migrate dev  # applies the new migration to their local DB
```
