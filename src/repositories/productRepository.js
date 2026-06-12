const prisma = require('../config/prismaClient');

const productRepository = {
  async findAll({ search, category, minPrice, maxPrice, page = 1, limit = 10 } = {}) {
    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = { equals: category, mode: 'insensitive' };
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = Number(minPrice);
      if (maxPrice !== undefined) where.price.lte = Number(maxPrice);
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      prisma.product.findMany({ where, skip, take: limitNum, orderBy: { createdAt: 'desc' } }),
      prisma.product.count({ where }),
    ]);

    return {
      data,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  },

  async findById(id) {
    return prisma.product.findUnique({ where: { id } });
  },

  async create(fields) {
    return prisma.product.create({ data: fields });
  },

  async update(id, fields) {
    return prisma.product.update({ where: { id }, data: fields });
  },

  async delete(id) {
    await prisma.product.delete({ where: { id } });
    return true;
  },

  async decrementStock(id, qty) {
    return prisma.product.update({
      where: { id },
      data: { stock: { decrement: qty } },
    });
  },

  async incrementStock(id, qty) {
    return prisma.product.update({
      where: { id },
      data: { stock: { increment: qty } },
    });
  },
};

module.exports = productRepository;
