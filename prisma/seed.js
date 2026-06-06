/**
 * Prisma seed script.
 * Run with: npm run db:seed
 *
 * Creates one admin user and five sample products.
 * Safe to re-run — skips records that already exist.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // ── Admin user ──────────────────────────────────────────────────────────────
  const existing = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });

  if (!existing) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: { name: 'Admin', email: 'admin@example.com', passwordHash, role: 'admin' },
    });
    console.log('✓ Admin user created  (admin@example.com / admin123)');
  } else {
    console.log('– Admin user already exists, skipping.');
  }

  // ── Sample products ─────────────────────────────────────────────────────────
  const products = [
    { name: 'Wireless Mouse',      description: 'Ergonomic wireless mouse',       price: 29.99, stock: 50,  category: 'Electronics' },
    { name: 'Mechanical Keyboard', description: 'TKL mechanical keyboard',         price: 89.99, stock: 30,  category: 'Electronics' },
    { name: 'USB-C Hub',           description: '7-in-1 USB-C hub',               price: 49.99, stock: 20,  category: 'Electronics' },
    { name: 'Desk Lamp',           description: 'LED desk lamp with USB charging', price: 34.99, stock: 40,  category: 'Office'      },
    { name: 'Notebook',            description: 'A5 hardcover notebook',           price:  9.99, stock: 100, category: 'Stationery'  },
  ];

  for (const p of products) {
    const found = await prisma.product.findFirst({ where: { name: p.name } });
    if (!found) {
      await prisma.product.create({ data: p });
      console.log(`✓ Product created: ${p.name}`);
    } else {
      console.log(`– Product already exists: ${p.name}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
