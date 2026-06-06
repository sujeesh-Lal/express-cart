const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');

const userService = {
  async getMe(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    return userRepository.sanitize(user);
  },

  async updateMe(userId, { name, email, password }) {
    const updates = {};
    if (name) updates.name = name;
    if (email) {
      const existing = await userRepository.findByEmail(email);
      if (existing && existing.id !== userId) {
        throw Object.assign(new Error('Email already in use'), { status: 409 });
      }
      updates.email = email;
    }
    if (password) updates.passwordHash = await bcrypt.hash(password, 10);

    const user = await userRepository.update(userId, updates);
    return userRepository.sanitize(user);
  },

  async deleteMe(userId) {
    await userRepository.delete(userId);
  },

  async getAllUsers() {
    const users = await userRepository.findAll();
    return users.map(userRepository.sanitize);
  },

  async deleteUser(id) {
    await userRepository.delete(id);
  },
};

module.exports = userService;
