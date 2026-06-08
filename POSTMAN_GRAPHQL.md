# Testing GraphQL with Postman

This guide walks through every GraphQL operation — Queries, Mutations, and Subscriptions — using Postman.

---

## Table of Contents

1. [Setup: Create a GraphQL Request in Postman](#1-setup-create-a-graphql-request-in-postman)
2. [Step 1 — Get an Auth Token (REST Login)](#2-step-1--get-an-auth-token-rest-login)
3. [Add Auth Header to GraphQL Requests](#3-add-auth-header-to-graphql-requests)
4. [Queries](#4-queries)
5. [Mutations](#5-mutations)
6. [Subscriptions](#6-subscriptions)
7. [Quick Reference — All Operations](#7-quick-reference--all-operations)

---

## 1. Setup: Create a GraphQL Request in Postman

Postman has a dedicated GraphQL mode that loads your schema automatically.

1. Click **New** → **GraphQL**
2. Enter the URL: `http://localhost:3000/graphql`
3. Click **Use Schema** → **Fetch from URL** → Postman will introspect the server and load all types and operations
4. You'll see the schema explorer on the left — click any operation to auto-fill the query

> **Make sure the server is running** (`npm run dev`) before fetching the schema.

---

## 2. Step 1 — Get an Auth Token (REST Login)

Mutations require an admin JWT. Get one first via the REST login endpoint.

- **Method:** `POST`
- **URL:** `http://localhost:3000/auth/login`
- **Headers:** `Content-Type: application/json`
- **Body (raw JSON):**

```json
{
  "email": "admin@example.com",
  "password": "admin123"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": "...", "name": "Admin", "email": "admin@example.com", "role": "admin" }
}
```

Copy the `accessToken` value — you'll use it in the next step.

---

## 3. Add Auth Header to GraphQL Requests

In your GraphQL request in Postman:

1. Click the **Headers** tab
2. Add a new header:
   - **Key:** `Authorization`
   - **Value:** `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` ← paste your token

> Queries (`product`, `products`) are **public** — no header needed.
> Mutations (`createProduct`, `updateProduct`, `deleteProduct`) are **admin only** — header required.

---

## 4. Queries

Queries are read operations. No auth required.

In Postman GraphQL mode, paste the query into the **Query** editor, paste variables into the **Variables** panel (bottom), then click **Query**.

---

### 4.1 Get a Single Product

**Query:**
```graphql
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    name
    description
    price
    stock
    category
    imageUrl
    createdAt
    updatedAt
  }
}
```

**Variables:**
```json
{
  "id": "PASTE_A_PRODUCT_ID_HERE"
}
```

> **Tip:** Run `GET http://localhost:3000/products` via REST first to get real product IDs from your database.

**Expected Response:**
```json
{
  "data": {
    "product": {
      "id": "abc-123",
      "name": "Wireless Mouse",
      "description": "Ergonomic wireless mouse",
      "price": 29.99,
      "stock": 50,
      "category": "Electronics",
      "imageUrl": "",
      "createdAt": "2024-06-15T10:00:00.000Z",
      "updatedAt": "2024-06-15T10:00:00.000Z"
    }
  }
}
```

If the ID doesn't exist, `data.product` will be `null`.

---

### 4.2 List All Products (no filters)

**Query:**
```graphql
query ListProducts {
  products {
    data {
      id
      name
      price
      stock
      category
    }
    total
    page
    limit
    totalPages
  }
}
```

**Variables:** *(none — leave empty)*

**Expected Response:**
```json
{
  "data": {
    "products": {
      "data": [
        { "id": "abc-123", "name": "Wireless Mouse", "price": 29.99, "stock": 50, "category": "Electronics" },
        { "id": "def-456", "name": "Mechanical Keyboard", "price": 89.99, "stock": 30, "category": "Electronics" }
      ],
      "total": 5,
      "page": 1,
      "limit": 10,
      "totalPages": 1
    }
  }
}
```

---

### 4.3 List Products with Search

**Query:**
```graphql
query SearchProducts($filters: ProductFiltersInput) {
  products(filters: $filters) {
    data {
      id
      name
      price
      stock
    }
    total
    totalPages
  }
}
```

**Variables:**
```json
{
  "filters": {
    "search": "keyboard"
  }
}
```

---

### 4.4 List Products with Category Filter

**Variables:**
```json
{
  "filters": {
    "category": "Electronics"
  }
}
```

---

### 4.5 List Products with Price Range

**Variables:**
```json
{
  "filters": {
    "minPrice": 20,
    "maxPrice": 60
  }
}
```

---

### 4.6 List Products with Pagination

**Variables:**
```json
{
  "filters": {
    "page": 1,
    "limit": 2
  }
}
```

---

### 4.7 All Filters Combined

**Variables:**
```json
{
  "filters": {
    "search": "mouse",
    "category": "Electronics",
    "minPrice": 10,
    "maxPrice": 100,
    "page": 1,
    "limit": 5
  }
}
```

---

## 5. Mutations

Mutations write data. All mutations require the `Authorization: Bearer <token>` header.

---

### 5.1 Create a Product

**Query:**
```graphql
mutation CreateProduct($input: CreateProductInput!) {
  createProduct(input: $input) {
    id
    name
    description
    price
    stock
    category
    imageUrl
    createdAt
  }
}
```

**Variables:**
```json
{
  "input": {
    "name": "Monitor Stand",
    "description": "Adjustable aluminium monitor stand",
    "price": 59.99,
    "stock": 25,
    "category": "Office",
    "imageUrl": ""
  }
}
```

**Expected Response:**
```json
{
  "data": {
    "createProduct": {
      "id": "newly-generated-uuid",
      "name": "Monitor Stand",
      "description": "Adjustable aluminium monitor stand",
      "price": 59.99,
      "stock": 25,
      "category": "Office",
      "imageUrl": "",
      "createdAt": "2024-06-15T12:00:00.000Z"
    }
  }
}
```

**Error (missing auth):**
```json
{
  "errors": [
    {
      "message": "Unauthenticated",
      "extensions": { "code": "UNAUTHENTICATED" }
    }
  ]
}
```

---

### 5.2 Update a Product

Only send the fields you want to change — everything else stays the same.

**Query:**
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

**Variables (update price and stock only):**
```json
{
  "id": "PASTE_PRODUCT_ID_HERE",
  "input": {
    "price": 49.99,
    "stock": 20
  }
}
```

**Variables (update name only):**
```json
{
  "id": "PASTE_PRODUCT_ID_HERE",
  "input": {
    "name": "Wireless Mouse Pro"
  }
}
```

**Error (product not found):**
```json
{
  "errors": [
    {
      "message": "Product not found",
      "extensions": { "code": "NOT_FOUND" }
    }
  ]
}
```

---

### 5.3 Delete a Product

**Query:**
```graphql
mutation DeleteProduct($id: ID!) {
  deleteProduct(id: $id)
}
```

**Variables:**
```json
{
  "id": "PASTE_PRODUCT_ID_HERE"
}
```

**Expected Response:**
```json
{
  "data": {
    "deleteProduct": true
  }
}
```

---

## 6. Subscriptions

Postman supports GraphQL subscriptions over WebSocket natively.

### Setup

1. Click **New** → **GraphQL**
2. Enter URL: `http://localhost:3000/graphql`
3. Write your subscription query (see below)
4. Click the **Connect** button — Postman opens a WebSocket connection
5. Click **Subscribe** — Postman starts listening

Leave the subscription tab open, then open a **second** Postman tab to run mutations. The subscription tab will receive events in real time.

### Auth for Subscriptions

1. Click the **Headers** tab on the subscription request
2. Add: `Authorization` → `Bearer <your_token>`

---

### 6.1 Subscribe to New Products

Open this subscription and leave it running. Every time `createProduct` is called, you'll see the new product appear here.

**Query:**
```graphql
subscription OnProductCreated {
  productCreated {
    id
    name
    price
    stock
    category
    createdAt
  }
}
```

**Event received when createProduct mutation runs:**
```json
{
  "data": {
    "productCreated": {
      "id": "newly-generated-uuid",
      "name": "Monitor Stand",
      "price": 59.99,
      "stock": 25,
      "category": "Office",
      "createdAt": "2024-06-15T12:00:00.000Z"
    }
  }
}
```

---

### 6.2 Subscribe to Product Updates

**Query:**
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

### 6.3 Subscribe to Product Deletions

**Query:**
```graphql
subscription OnProductDeleted {
  productDeleted
}
```

**Event received when deleteProduct mutation runs:**
```json
{
  "data": {
    "productDeleted": "deleted-product-uuid"
  }
}
```

---

### Testing Subscriptions End-to-End

1. **Tab 1** — Open `OnProductCreated` subscription and click **Subscribe**. Status shows `Connected`.
2. **Tab 2** — Run `createProduct` mutation with auth header.
3. **Tab 1** — Within milliseconds you'll see the new product appear in the subscription response panel.

---

## 7. Quick Reference — All Operations

### Endpoint
```
http://localhost:3000/graphql
```

### Headers
| Header         | Value                    | Required for         |
|----------------|--------------------------|----------------------|
| Content-Type   | application/json         | All requests         |
| Authorization  | Bearer `<accessToken>`   | Mutations only       |

### All Operations

| Type         | Operation         | Auth     | Description                              |
|--------------|-------------------|----------|------------------------------------------|
| Query        | `product`         | Public   | Get one product by ID                    |
| Query        | `products`        | Public   | List products with filter/search/page    |
| Mutation     | `createProduct`   | Admin    | Create a new product                     |
| Mutation     | `updateProduct`   | Admin    | Update fields on an existing product     |
| Mutation     | `deleteProduct`   | Admin    | Delete a product by ID                   |
| Subscription | `productCreated`  | Public   | Real-time stream of new products         |
| Subscription | `productUpdated`  | Public   | Real-time stream of updated products     |
| Subscription | `productDeleted`  | Public   | Real-time stream of deleted product IDs  |

### All Input Fields

**CreateProductInput**
| Field         | Type    | Required |
|---------------|---------|----------|
| name          | String  | ✅       |
| price         | Float   | ✅       |
| stock         | Int     | ✅       |
| description   | String  | ❌       |
| category      | String  | ❌       |
| imageUrl      | String  | ❌       |

**UpdateProductInput** — all fields optional
| Field         | Type    |
|---------------|---------|
| name          | String  |
| description   | String  |
| price         | Float   |
| stock         | Int     |
| category      | String  |
| imageUrl      | String  |

**ProductFiltersInput** — all fields optional
| Field         | Type    | Description                    |
|---------------|---------|--------------------------------|
| search        | String  | Search in name and description |
| category      | String  | Exact category match           |
| minPrice      | Float   | Minimum price                  |
| maxPrice      | Float   | Maximum price                  |
| page          | Int     | Page number (default: 1)       |
| limit         | Int     | Results per page (default: 10) |
