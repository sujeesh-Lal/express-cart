const typeDefs = /* GraphQL */ `
  # ─── Types ──────────────────────────────────────────────────────────────────

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

  # ─── Inputs ─────────────────────────────────────────────────────────────────

  input ProductFiltersInput {
    search: String
    category: String
    minPrice: Float
    maxPrice: Float
    page: Int
    limit: Int
  }

  input CreateProductInput {
    name: String!
    description: String
    price: Float!
    stock: Int!
    category: String
    imageUrl: String
  }

  input UpdateProductInput {
    name: String
    description: String
    price: Float
    stock: Int
    category: String
    imageUrl: String
  }

  # ─── Query ───────────────────────────────────────────────────────────────────
  # Public — no auth required

  type Query {
    """Fetch a single product by ID."""
    product(id: ID!): Product

    """List products with optional filtering, search, and pagination."""
    products(filters: ProductFiltersInput): ProductList!
  }

  # ─── Mutation ────────────────────────────────────────────────────────────────
  # Admin only — requires a valid JWT with role: admin

  type Mutation {
    """Create a new product. Requires admin role."""
    createProduct(input: CreateProductInput!): Product!

    """Update an existing product. Requires admin role."""
    updateProduct(id: ID!, input: UpdateProductInput!): Product!

    """Delete a product by ID. Returns true on success. Requires admin role."""
    deleteProduct(id: ID!): Boolean!
  }

  # ─── Subscription ────────────────────────────────────────────────────────────
  # Real-time events pushed to connected WebSocket clients

  type Subscription {
    """Fires whenever a new product is created."""
    productCreated: Product!

    """Fires whenever a product is updated."""
    productUpdated: Product!

    """Fires whenever a product is deleted. Returns the deleted product's ID."""
    productDeleted: ID!
  }
`;

module.exports = { typeDefs };
