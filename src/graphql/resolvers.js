const productRepository = require('../repositories/productRepository');
const { pubsub, EVENTS } = require('./pubsub');

/**
 * Throw a formatted GraphQL error with an HTTP-like status code extension.
 * Apollo Studio and most clients surface this under error.extensions.code.
 */
function gqlError(message, code, status) {
  const err = new Error(message);
  err.extensions = { code, http: { status } };
  return err;
}

/** Confirm the context user exists and is an admin. */
function requireAdmin(user) {
  if (!user) throw gqlError('Unauthenticated', 'UNAUTHENTICATED', 401);
  if (user.role !== 'admin') throw gqlError('Forbidden', 'FORBIDDEN', 403);
}

const resolvers = {
  // ─── Queries ───────────────────────────────────────────────────────────────

  Query: {
    /**
     * product(id: ID!): Product
     * Public — returns null if not found (matches REST 404 behaviour).
     */
    async product(_, { id }) {
      return productRepository.findById(id);
    },

    /**
     * products(filters: ProductFiltersInput): ProductList!
     * Public — supports search, category, price range, and pagination.
     */
    async products(_, { filters = {} }) {
      return productRepository.findAll(filters);
    },
  },

  // ─── Mutations ─────────────────────────────────────────────────────────────

  Mutation: {
    /**
     * createProduct(input: CreateProductInput!): Product!
     * Admin only. Publishes PRODUCT_CREATED event after creation.
     */
    async createProduct(_, { input }, { user }) {
      requireAdmin(user);

      const product = await productRepository.create(input);

      // Notify all PRODUCT_CREATED subscribers
      pubsub.publish(EVENTS.PRODUCT_CREATED, { productCreated: product });

      return product;
    },

    /**
     * updateProduct(id: ID!, input: UpdateProductInput!): Product!
     * Admin only. Publishes PRODUCT_UPDATED event after update.
     */
    async updateProduct(_, { id, input }, { user }) {
      requireAdmin(user);

      let product;
      try {
        product = await productRepository.update(id, input);
      } catch (err) {
        if (err.code === 'P2025') throw gqlError('Product not found', 'NOT_FOUND', 404);
        throw err;
      }

      pubsub.publish(EVENTS.PRODUCT_UPDATED, { productUpdated: product });

      return product;
    },

    /**
     * deleteProduct(id: ID!): Boolean!
     * Admin only. Publishes PRODUCT_DELETED event with the deleted ID.
     */
    async deleteProduct(_, { id }, { user }) {
      requireAdmin(user);

      try {
        await productRepository.delete(id);
      } catch (err) {
        if (err.code === 'P2025') throw gqlError('Product not found', 'NOT_FOUND', 404);
        throw err;
      }

      pubsub.publish(EVENTS.PRODUCT_DELETED, { productDeleted: id });

      return true;
    },
  },

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  Subscription: {
    /**
     * productCreated: Product!
     * Pushes the full product object whenever a new product is created.
     */
    productCreated: {
      subscribe: () => pubsub.asyncIterator([EVENTS.PRODUCT_CREATED]),
    },

    /**
     * productUpdated: Product!
     * Pushes the updated product object whenever a product is updated.
     */
    productUpdated: {
      subscribe: () => pubsub.asyncIterator([EVENTS.PRODUCT_UPDATED]),
    },

    /**
     * productDeleted: ID!
     * Pushes the deleted product's ID whenever a product is deleted.
     */
    productDeleted: {
      subscribe: () => pubsub.asyncIterator([EVENTS.PRODUCT_DELETED]),
    },
  },
};

module.exports = { resolvers };
