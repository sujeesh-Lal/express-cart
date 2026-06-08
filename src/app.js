const http = require('http');
const express = require('express');
const { port } = require('./config/env');
const prisma = require('./config/prismaClient');
const errorHandler = require('./middleware/errorHandler');
const { applyGraphQL } = require('./graphql/server');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();
app.use(express.json());

// ── REST routes ───────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/products', productRoutes);
app.use('/cart', cartRoutes);
app.use('/orders', orderRoutes);
app.use('/payments', paymentRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// 404 and errorHandler are registered AFTER applyGraphQL so that the /graphql
// route is in place before the catch-all 404 handler is added.
// Express matches middleware in registration order — if 404 came first, every
// request to /graphql would be caught by it before reaching Apollo Server.

const httpServer = http.createServer(app);

async function start() {
  // Mount GraphQL (HTTP + WebSocket) on the shared http.Server
  await applyGraphQL(app, httpServer);

  // 404 — must be after all routes including /graphql
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

  // Central error handler — must be last
  app.use(errorHandler);

  httpServer.listen(port, () => {
    console.log(`REST API  → http://localhost:${port}`);
    console.log(`GraphQL   → http://localhost:${port}/graphql`);
    console.log(`WS Subs   → ws://localhost:${port}/graphql`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  httpServer.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
