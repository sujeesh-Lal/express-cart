/**
 * In-memory user store — replace with DB queries later.
 */
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');

// Seed one admin user (passwordHash = bcrypt of "admin123")
const users = [
  new User({
    id: 'admin-001',
    name: 'Admin',
    email: 'admin@example.com',
    // bcrypt hash of "admin123" — pre-computed so no async on startup
    passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    role: 'admin',
  }),
];

const userRepository = {
  findAll() {
    return [...users];
  },

  findById(id) {
    return users.find((u) => u.id === id) || null;
  },

  findByEmail(email) {
    return users.find((u) => u.email === email) || null;
  },

  create({ name, email, passwordHash, role = 'user' }) {
    const user = new User({ id: uuidv4(), name, email, passwordHash, role });
    users.push(user);
    return user;
  },

  update(id, fields) {
    const user = users.find((u) => u.id === id);
    if (!user) return null;
    Object.assign(user, fields, { updatedAt: new Date() });
    return user;
  },

  delete(id) {
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return false;
    users.splice(idx, 1);
    return true;
  },
};

module.exports = userRepository;
