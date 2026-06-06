# Express Cart — E-Commerce Shopping Cart API

A fully-structured REST API for an e-commerce shopping cart, built with **Node.js**, **Express**, and **PostgreSQL** via **Prisma ORM**. Stripe payment integration is stubbed and ready to be wired in.

---

## Tech Stack

- **Node.js** + **Express** — HTTP server and routing
- **PostgreSQL** — relational database
- **Prisma ORM** — type-safe database access, migrations, and schema management
- **bcryptjs** — password hashing
- **jsonwebtoken** — JWT access tokens + refresh token rotation
- **dotenv** — environment config

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL running locally (or a hosted instance such as Supabase, Railway, or Neon)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and fill in your DATABASE_URL
cp .env.example .env

# 3. Run database migrations (creates all tables)
npm run db:migrate

# 4. Seed the database (admin user + sample products)
npm run db:seed

# 5. Start development server (auto-restarts on file changes)
npm run dev
```

The server runs on `http://localhost:3000` by default.

### Database Scripts

| Command              | Description                                        |
|----------------------|----------------------------------------------------|
| `npm run db:migrate` | Apply pending migrations (creates tables)          |
| `npm run db:push`    | Push schema changes directly (no migration files)  |
| `npm run db:seed`    | Insert admin user and sample products              |
| `npm run db:studio`  | Open Prisma Studio — visual DB browser             |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |

### Seeded Data

One admin account is available after running `npm run db:seed`:

| Field    | Value               |
|----------|---------------------|
| Email    | admin@example.com   |
| Password | admin123            |
| Role     | admin               |

Five sample products (Electronics, Office, Stationery) are also seeded.

---

## Project Structure

```
express-cart/
├── .env.example              # Environment variable template
├── .gitignore
├── package.json
├── README.md
├── TECHNICAL.md              # Architecture and flow deep-dive
├── prisma/
│   ├── schema.prisma         # Database schema and Prisma config
│   └── seed.js               # Seed script (admin user + products)
└── src/
    ├── app.js                # Entry point — Express setup, route mounting
    ├── config/
    │   └── env.js            # Centralised env config (reads .env)
    ├── models/               # Data shape definitions
    │   ├── User.js
    │   ├── Product.js
    │   ├── Cart.js
    │   ├── CartItem.js
    │   └── Order.js
    ├── repositories/         # Data access layer (in-memory → swap for DB)
    │   ├── userRepository.js
    │   ├── productRepository.js
    │   ├── cartRepository.js
    │   └── orderRepository.js
    ├── services/             # Business logic
    │   ├── authService.js
    │   ├── userService.js
    │   ├── productService.js
    │   ├── cartService.js
    │   ├── orderService.js
    │   └── paymentService.js
    ├── controllers/          # HTTP request/response handling
    │   ├── authController.js
    │   ├── userController.js
    │   ├── productController.js
    │   ├── cartController.js
    │   ├── orderController.js
    │   └── paymentController.js
    ├── routes/               # Route definitions (URL → controller)
    │   ├── authRoutes.js
    │   ├── userRoutes.js
    │   ├── productRoutes.js
    │   ├── cartRoutes.js
    │   ├── orderRoutes.js
    │   └── paymentRoutes.js
    └── middleware/
        ├── authenticate.js   # JWT verification → attaches req.user
        ├── authorize.js      # Role-based access control
        ├── validate.js       # Request body validation
        └── errorHandler.js   # Central error handler
```

---

## API Endpoints

All protected routes require the header:
```
Authorization: Bearer <accessToken>
```

### Auth

| Method | Endpoint              | Auth     | Description                  |
|--------|-----------------------|----------|------------------------------|
| POST   | /auth/register        | Public   | Register a new user          |
| POST   | /auth/login           | Public   | Login, receive tokens        |
| POST   | /auth/logout          | Public   | Invalidate refresh token     |
| POST   | /auth/refresh-token   | Public   | Rotate and get new tokens    |

**Register body:**
```json
{ "name": "Jane Doe", "email": "jane@example.com", "password": "secret123" }
```

**Login body:**
```json
{ "email": "jane@example.com", "password": "secret123" }
```

---

### Users

| Method | Endpoint      | Auth        | Description              |
|--------|---------------|-------------|--------------------------|
| GET    | /users/me     | User        | Get own profile          |
| PUT    | /users/me     | User        | Update own profile       |
| DELETE | /users/me     | User        | Delete own account       |
| GET    | /users        | Admin only  | List all users           |
| DELETE | /users/:id    | Admin only  | Delete a user            |

---

### Products

| Method | Endpoint         | Auth        | Description                        |
|--------|------------------|-------------|------------------------------------|
| GET    | /products        | Public      | List products (filter/search/page) |
| GET    | /products/:id    | Public      | Get a single product               |
| POST   | /products        | Admin only  | Create a product                   |
| PUT    | /products/:id    | Admin only  | Update a product                   |
| DELETE | /products/:id    | Admin only  | Delete a product                   |

**Query parameters for GET /products:**

| Param    | Example               | Description                          |
|----------|-----------------------|--------------------------------------|
| search   | ?search=keyboard      | Full-text search on name/description |
| category | ?category=Electronics | Filter by category                   |
| minPrice | ?minPrice=10          | Minimum price filter                 |
| maxPrice | ?maxPrice=50          | Maximum price filter                 |
| page     | ?page=2               | Page number (default: 1)             |
| limit    | ?limit=5              | Results per page (default: 10)       |

---

### Cart

| Method | Endpoint                  | Auth | Description           |
|--------|---------------------------|------|-----------------------|
| GET    | /cart                     | User | View cart             |
| POST   | /cart/items               | User | Add item to cart      |
| PUT    | /cart/items/:productId    | User | Update item quantity  |
| DELETE | /cart/items/:productId    | User | Remove item from cart |
| DELETE | /cart                     | User | Clear entire cart     |

**Add item body:**
```json
{ "productId": "p-001", "quantity": 2 }
```

---

### Orders

| Method | Endpoint               | Auth        | Description                       |
|--------|------------------------|-------------|-----------------------------------|
| POST   | /orders                | User        | Checkout — converts cart to order |
| GET    | /orders                | User        | Get own order history             |
| GET    | /orders/:id            | User        | Get a specific order              |
| DELETE | /orders/:id/cancel     | User        | Cancel an order                   |
| GET    | /orders/admin/all      | Admin only  | List all orders                   |
| PUT    | /orders/:id/status     | Admin only  | Update order status               |

**Update status body:**
```json
{ "status": "shipped" }
```

Valid statuses: `pending` | `processing` | `shipped` | `delivered` | `cancelled`

---

### Payments

| Method | Endpoint                  | Auth   | Description                           |
|--------|---------------------------|--------|---------------------------------------|
| POST   | /payments/checkout        | User   | Create Stripe payment intent (mocked) |
| POST   | /payments/webhook         | Public | Stripe webhook handler (mocked)       |
| GET    | /payments/:orderId        | User   | Get payment status for an order       |

**Checkout body:**
```json
{ "orderId": "<order-id>" }
```

---

## Environment Variables

| Variable               | Description                           | Default            |
|------------------------|---------------------------------------|--------------------|
| PORT                   | Server port                           | 3000               |
| NODE_ENV               | Environment (development/production)  | development        |
| JWT_SECRET             | Secret for signing access tokens      | dev_jwt_secret     |
| JWT_EXPIRES_IN         | Access token expiry                   | 15m                |
| JWT_REFRESH_SECRET     | Secret for signing refresh tokens     | dev_refresh_secret |
| JWT_REFRESH_EXPIRES_IN | Refresh token expiry                  | 7d                 |
| STRIPE_SECRET_KEY      | Stripe secret key (for later)         | —                  |
| STRIPE_WEBHOOK_SECRET  | Stripe webhook signing secret         | —                  |

---

## What's Mocked

The database layer is real (PostgreSQL via Prisma). Stripe is still stubbed:

- **Stripe payment intent** (`POST /payments/checkout`) — returns a mock `pi_mock_*` object.
- **Stripe webhook** (`POST /payments/webhook`) — simulates a `payment_intent.succeeded` event.

See `TECHNICAL.md` for how to replace these stubs with the real Stripe SDK.
