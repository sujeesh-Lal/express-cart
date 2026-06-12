require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_jwt_secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  grpc: {
    // Port this process binds as a gRPC server
    port: Number(process.env.GRPC_PORT) || 50051,
    // Address of the remote Product Service gRPC server (client side).
    // Set to activate gRPC mode; leave blank for REST or monolith mode.
    productAddr: process.env.PRODUCT_GRPC_ADDR || '',
  },
  services: {
    // Set this to enable microservice mode for the Product Service.
    // Leave blank to run in monolith mode (direct DB access).
    productServiceUrl: process.env.PRODUCT_SERVICE_URL || '',
    // Shared secret used to sign and verify service-to-service JWTs.
    serviceJwtSecret:  process.env.SERVICE_JWT_SECRET  || 'dev_service_secret',
    // Long-lived token this service sends as Authorization header on outbound calls.
    serviceToken:      process.env.SERVICE_TOKEN       || '',
  },
};
