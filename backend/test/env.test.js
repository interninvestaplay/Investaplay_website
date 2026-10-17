const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'development';
const env = require('../src/config/env');

test('development client origins include Expo web port 8082', () => {
  assert.ok(env.clientOrigins.includes('http://localhost:8082'));
});
