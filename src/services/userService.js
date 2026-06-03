const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');

const userService = {
  getMe(userId) {
    const user = userRepository.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    return user;
  },

  async updateMe(userId, { name, email, password }) {
    const updates = {};
    if (name) updates.name = name;
    if (email) {
      const existing = userRepository.findByEmail(email);
      if (existing && existing.id !== userId) {
        throw Object.assign(new Error('Email already in use'), { status: 409 });
      }
      updates.email = email;
    }
    if (password) updates.passwordHash = await bcrypt.hash(password, 10);

    const user = userRepository.update(userId, updates);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    return user;
  },

  deleteMe(userId) {
    const deleted = userRepository.delete(userId);
    if (!deleted) throw Object.assign(new Error('User not found'), { status: 404 });
  },

  getAllUsers() {
    return userRepository.findAll();
  },

  deleteUser(id) {
    const deleted = userRepository.delete(id);
    if (!deleted) throw Object.assign(new Error('User not found'), { status: 404 });
  },
};

module.exports = userService;
