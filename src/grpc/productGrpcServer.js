/**
 * productGrpcServer — gRPC server for the Product Service.
 *
 * Implements all four RPCs defined in proto/product.proto:
 *   GetProduct     — single product lookup
 *   ReserveStock   — atomic multi-item stock decrement (checkout)
 *   ReleaseStock   — restore stock (cancel / rollback)
 *   WatchPrice     — server-streaming price change notifications
 *
 * Start it from app.js:
 *   const { startGrpcServer } = require('./grpc/productGrpcServer');
 *   const grpcServer = await startGrpcServer();
 */

const grpc        = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path        = require('path');
const prisma      = require('../config/prismaClient');
const productRepository = require('../repositories/productRepository');
const { grpc: grpcConfig } = require('../config/env');

// ── Proto loading ─────────────────────────────────────────────────────────────

const PROTO_PATH = path.join(__dirname, '../../proto/product.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase:  true,
  longs:     String,
  enums:     String,
  defaults:  true,
  oneofs:    true,
});

const { product: pkg } = grpc.loadPackageDefinition(packageDef);

// ── Price-change event emitter (in-process pub/sub) ───────────────────────────
// In production replace with a Redis pub/sub or DB trigger listener.
const { EventEmitter } = require('events');
const priceEvents = new EventEmitter();
priceEvents.setMaxListeners(100);

/**
 * Call this whenever a product price is updated elsewhere in the codebase
 * so that WatchPrice streams are notified.
 *
 * @param {string} productId
 * @param {number} oldPrice
 * @param {number} newPrice
 */
function emitPriceChange(productId, oldPrice, newPrice) {
  priceEvents.emit('price_change', { productId, oldPrice, newPrice });
}

// ── RPC Handlers ──────────────────────────────────────────────────────────────

/**
 * GetProduct — returns a single product by ID.
 */
async function getProduct(call, callback) {
  try {
    const product = await productRepository.findById(call.request.id);
    if (!product) {
      return callback(null, { found: false });
    }
    callback(null, {
      id:          product.id,
      name:        product.name,
      price:       product.price,
      stock:       product.stock,
      category:    product.category   || '',
      description: product.description || '',
      found:       true,
    });
  } catch (err) {
    console.error('[gRPC:GetProduct]', err.message);
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
}

/**
 * ReserveStock — atomically validate and decrement stock for all items.
 * Runs inside a Prisma transaction: all-or-nothing.
 */
async function reserveStock(call, callback) {
  const { order_id, items } = call.request;

  try {
    const reserved = await prisma.$transaction(async (tx) => {
      const result = [];

      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.id } });

        if (!product) {
          throw Object.assign(
            new Error(`Product ${item.id} not found`),
            { code: grpc.status.NOT_FOUND }
          );
        }

        if (product.stock < item.quantity) {
          throw Object.assign(
            new Error(`Insufficient stock for "${product.name}" (available: ${product.stock})`),
            { code: grpc.status.FAILED_PRECONDITION }
          );
        }

        await tx.product.update({
          where: { id: item.id },
          data:  { stock: { decrement: item.quantity } },
        });

        result.push({
          id:            product.id,
          name:          product.name,
          price_at_time: product.price,
          quantity:      item.quantity,
        });
      }

      return result;
    });

    callback(null, { success: true, error_message: '', items: reserved });
  } catch (err) {
    console.error(`[gRPC:ReserveStock] order=${order_id}`, err.message);
    // Return a structured failure rather than a gRPC error so callers can
    // inspect error_message without catching an exception.
    callback(null, { success: false, error_message: err.message, items: [] });
  }
}

/**
 * ReleaseStock — increment stock back for each item (compensating call).
 */
async function releaseStock(call, callback) {
  const { order_id, items } = call.request;

  try {
    await prisma.$transaction(
      items.map((item) =>
        prisma.product.update({
          where: { id: item.id },
          data:  { stock: { increment: item.quantity } },
        })
      )
    );
    callback(null, { success: true });
  } catch (err) {
    console.error(`[gRPC:ReleaseStock] order=${order_id}`, err.message);
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
}

/**
 * WatchPrice — server-streaming.
 * Sends a PriceUpdate whenever priceEvents emits 'price_change' for this product.
 * Stream stays open until the client cancels.
 */
function watchPrice(call) {
  const { product_id } = call.request;
  console.info(`[gRPC:WatchPrice] client subscribed to product ${product_id}`);

  function onPriceChange({ productId, oldPrice, newPrice }) {
    if (productId !== product_id) return;
    try {
      call.write({
        product_id: productId,
        old_price:  oldPrice,
        new_price:  newPrice,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Stream already closed — ignore
    }
  }

  priceEvents.on('price_change', onPriceChange);

  call.on('cancelled', () => {
    priceEvents.off('price_change', onPriceChange);
    console.info(`[gRPC:WatchPrice] client unsubscribed from product ${product_id}`);
  });
}

// ── Server bootstrap ──────────────────────────────────────────────────────────

function startGrpcServer(port = grpcConfig.port) {
  return new Promise((resolve, reject) => {
    const server = new grpc.Server();

    server.addService(pkg.ProductService.service, {
      getProduct,
      reserveStock,
      releaseStock,
      watchPrice,
    });

    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(), // swap for createSsl() in production
      (err, boundPort) => {
        if (err) return reject(err);
        console.info(`[gRPC] Product service listening on :${boundPort}`);
        resolve(server);
      }
    );
  });
}

module.exports = { startGrpcServer, emitPriceChange };
