/**
 * User model shape (no DB yet — used as reference for mock data)
 * {
 *   id: string (uuid),
 *   name: string,
 *   email: string,
 *   passwordHash: string,
 *   role: 'user' | 'admin',
 *   createdAt: Date,
 *   updatedAt: Date,
 * }
 */

class User {
  constructor({ id, name, email, passwordHash, role = 'user', createdAt, updatedAt }) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.passwordHash = passwordHash;
    this.role = role;
    this.createdAt = createdAt || new Date();
    this.updatedAt = updatedAt || new Date();
  }

  // Return safe public fields (no passwordHash)
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      role: this.role,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = User;
