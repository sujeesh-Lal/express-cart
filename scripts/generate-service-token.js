/**
 * Generate a service-to-service JWT for use in Postman or scripts.
 *
 * Usage:
 *   node scripts/generate-service-token.js
 *   node scripts/generate-service-token.js --name order-service --expiry 365d
 *
 * Copy the printed token into:
 *   • Postman → Environments → service_token variable
 *   • .env    → SERVICE_TOKEN=<token>
 */

require('dotenv').config();
const jwt  = require('jsonwebtoken');

const args  = process.argv.slice(2);
const name   = args[args.indexOf('--name')   + 1] || 'postman-test-client';
const expiry = args[args.indexOf('--expiry') + 1] || '365d';
const secret = process.env.SERVICE_JWT_SECRET || 'dev_service_secret';

const token = jwt.sign(
  { type: 'service', name },
  secret,
  { expiresIn: expiry }
);

console.log('\n──────────────────────────────────────────────────────');
console.log('Service JWT');
console.log('──────────────────────────────────────────────────────');
console.log(`Name   : ${name}`);
console.log(`Expiry : ${expiry}`);
console.log(`Secret : ${secret === 'dev_service_secret' ? 'dev_service_secret (default)' : '(from .env)'}`);
console.log('──────────────────────────────────────────────────────');
console.log('\nToken (copy this into Postman → service_token):\n');
console.log(token);
console.log('\n');
