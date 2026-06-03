/**
 * Simple request body validators.
 * Returns a 400 with field-level errors if validation fails.
 *
 * Usage: validate(rules.register)
 * Each rule is an object: { field, required, type, minLength, min }
 */

function validate(rules) {
  return (req, res, next) => {
    const errors = [];

    for (const rule of rules) {
      const value = req.body[rule.field];

      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push({ field: rule.field, message: `${rule.field} is required` });
        continue;
      }

      if (value === undefined || value === null) continue;

      if (rule.type === 'string' && typeof value !== 'string') {
        errors.push({ field: rule.field, message: `${rule.field} must be a string` });
      }
      if (rule.type === 'number' && typeof value !== 'number') {
        errors.push({ field: rule.field, message: `${rule.field} must be a number` });
      }
      if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) {
        errors.push({ field: rule.field, message: `${rule.field} must be at least ${rule.minLength} characters` });
      }
      if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
        errors.push({ field: rule.field, message: `${rule.field} must be at least ${rule.min}` });
      }
      if (rule.isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors.push({ field: rule.field, message: `${rule.field} must be a valid email` });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    next();
  };
}

// Pre-built rule sets
validate.rules = {
  register: [
    { field: 'name', required: true, type: 'string', minLength: 2 },
    { field: 'email', required: true, type: 'string', isEmail: true },
    { field: 'password', required: true, type: 'string', minLength: 6 },
  ],
  login: [
    { field: 'email', required: true, type: 'string', isEmail: true },
    { field: 'password', required: true, type: 'string' },
  ],
  createProduct: [
    { field: 'name', required: true, type: 'string', minLength: 1 },
    { field: 'price', required: true, type: 'number', min: 0 },
    { field: 'stock', required: true, type: 'number', min: 0 },
  ],
  addCartItem: [
    { field: 'productId', required: true, type: 'string' },
    { field: 'quantity', required: false, type: 'number', min: 1 },
  ],
  updateCartItem: [
    { field: 'quantity', required: true, type: 'number', min: 0 },
  ],
};

module.exports = validate;
