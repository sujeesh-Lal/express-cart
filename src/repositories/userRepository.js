const prisma = require('../config/prismaClient');

/**
 * Strip passwordHash before sending user data in responses.
 * Always call this before returning a user to a controller.
 */
function sanitize(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

const userRepository = {
  sanitize,

  async findAll() {
    return prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async findById(id) {
    return prisma.user.findUnique({ where: { id } });
  },

  async findByEmail(email) {
    return prisma.user.findUnique({ where: { email } });
  },

  async create({ name, email, passwordHash, role = 'user' }) {
    return prisma.user.create({ data: { name, email, passwordHash, role } });
  },

  async update(id, fields) {
    return prisma.user.update({ where: { id }, data: fields });
  },

  async delete(id) {
    await prisma.user.delete({ where: { id } });
    return true;
  },
};

module.exports = userRepository;
