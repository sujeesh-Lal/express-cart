/**
 * productGrpcClient — gRPC client for the Product Service.
 *
 * Used by Cart Service and Order Service when PRODUCT_GRPC_ADDR is set.
 * A single channel is created at module load time; HTTP/2 multiplexes
 * all concurrent calls over it so there is no per-request overhead.
 *
 * Methods:
 *   getProduct(id)                         → ProductResponse
 *   reserveStock(orderId, items)           → ReserveStockResponse
 *   releaseStock(orderId, items)           → ReleaseStockResponse
 *   watchPrice(productId, onUpdate, onEnd) → cancel function
 */

const grpc        = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path        = require('path');
const { grpc: grpcConfig } = require('../config/env');

// ── Proto loading ─────────────────────────────────────────────────────────────

const PROTO_PATH = path.join(__dirname, '../../proto/product.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs:    String,
  enums:    String,
  defaults: true,
  oneofs:   true,
});

const { product: pkg } = grpc.loadPackageDefinition(packageDef);

// ── Shared channel ────────────────────────────────────────────────────────────

let _client = null;

function getClient() {
  if (!_client) {
    const addr = grpcConfig.productAddr || 'localhost:50051';
    _client = new pkg.ProductService(
      addr,
      grpc.credentials.createInsecure() // swap for createSsl() in production
    );
    console.info(`[gRPC client] Connected to Product Service at ${addr}`);
  }
  return _client;
}

// ── gRPC status → HTTP-like error mapper ──────────────────────────────────────

const STATUS_TO_HTTP = {
  [grpc.status.NOT_FOUND]:           404,
  [grpc.status.INVALID_ARGUMENT]:    400,
  [grpc.status.ALREADY_EXISTS]:      409,
  [grpc.status.FAILED_PRECONDITION]: 400,
  [grpc.status.INTERNAL]:            500,
  [grpc.status.UNAVAILABLE]:         503,
  [grpc.status.DEADLINE_EXCEEDED]:   504,
};

function grpcError(err) {
  const status = STATUS_TO_HTTP[err.code] || 500;
  return Object.assign(new Error(err.message || 'gRPC error'), { status });
}

// ── Deadline helper (ms → gRPC deadline) ─────────────────────────────────────

function deadline(ms = 5000) {
  return new Date(Date.now() + ms);
}

// ── Client API ────────────────────────────────────────────────────────────────

const productGrpcClient = {
  /**
   * Fetch a single product.
   * Returns null if not found (found: false in proto response).
   *
   * @param  {string}  id
   * @returns {Promise<object|null>}
   */
  getProduct(id) {
    return new Promise((resolve, reject) => {
      getClient().getProduct(
        { id },
        { deadline: deadline(5000) },
        (err, res) => {
          if (err)          return reject(grpcError(err));
          if (!res.found)   return resolve(null);
          resolve(res);
        }
      );
    });
  },

  /**
   * Atomically reserve (decrement) stock for multiple cart items.
   *
   * @param  {string}   orderId
   * @param  {{ id: string, quantity: number }[]} items
   * @returns {Promise<{ success, error_message, items }>}
   */
  reserveStock(orderId, items) {
    return new Promise((resolve, reject) => {
      getClient().reserveStock(
        { order_id: orderId, items },
        { deadline: deadline(10000) },
        (err, res) => {
          if (err) return reject(grpcError(err));
          resolve(res);
        }
      );
    });
  },

  /**
   * Release (restore) previously reserved stock.
   *
   * @param  {string}   orderId
   * @param  {{ id: string, quantity: number }[]} items
   * @returns {Promise<{ success }>}
   */
  releaseStock(orderId, items) {
    return new Promise((resolve, reject) => {
      getClient().releaseStock(
        { order_id: orderId, items },
        { deadline: deadline(10000) },
        (err, res) => {
          if (err) return reject(grpcError(err));
          resolve(res);
        }
      );
    });
  },

  /**
   * Subscribe to price changes for a product (server-streaming).
   *
   * @param  {string}   productId
   * @param  {(update: PriceUpdate) => void} onUpdate  — called on each update
   * @param  {(err?)  => void}               onEnd     — called when stream ends
   * @returns {() => void}  cancel function — call to stop the stream
   */
  watchPrice(productId, onUpdate, onEnd = () => {}) {
    const stream = getClient().watchPrice({ product_id: productId });

    stream.on('data',  (update) => onUpdate(update));
    stream.on('end',   ()       => onEnd());
    stream.on('error', (err)    => onEnd(err));

    return () => stream.cancel();
  },
};

module.exports = productGrpcClient;
