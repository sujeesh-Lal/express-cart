/**
 * Shared PrismaClient singleton.
 *
 * Import this file everywhere instead of calling `new PrismaClient()` directly.
 * Creating multiple instances wastes connection pool slots.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

module.exports = prisma;
