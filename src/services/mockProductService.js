/**
 * Mock Product Service
 *
 * Returns static fallback data when the circuit breaker is OPEN.
 * The response shape matches productRepository.findAll exactly.
 */

const MOCK_PRODUCTS = [
  {
    id: 'mock-1',
    name: 'Mock Laptop',
    description: 'A placeholder laptop (service unavailable)',
    price: 999.99,
    stock: 0,
    category: 'Electronics',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
  {
    id: 'mock-2',
    name: 'Mock Headphones',
    description: 'A placeholder headphones (service unavailable)',
    price: 49.99,
    stock: 0,
    category: 'Electronics',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
  {
    id: 'mock-3',
    name: 'Mock T-Shirt',
    description: 'A placeholder t-shirt (service unavailable)',
    price: 19.99,
    stock: 0,
    category: 'Clothing',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
];

const mockProductService = {
  /**
   * Returns paginated mock products.
   * Mirrors the shape returned by productRepository.findAll.
   */
  async listProducts({ page = 1, limit = 10 } = {}) {
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const start = (pageNum - 1) * limitNum;
    const data = MOCK_PRODUCTS.slice(start, start + limitNum);

    return {
      data,
      total: MOCK_PRODUCTS.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(MOCK_PRODUCTS.length / limitNum),
      isMockData: true, // flag so callers/clients know this is fallback data
    };
  },
};

module.exports = mockProductService;
