const mysql = require('mysql2/promise');
const env = require('../config/env');

function createPoolInstance() {
  return mysql.createPool({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
  });
}

let poolInstance = createPoolInstance();

function getPool() {
  if (!poolInstance || poolInstance.pool?._closed) {
    poolInstance = createPoolInstance();
  }
  return poolInstance;
}

const pool = new Proxy({}, {
  get(target, prop) {
    const active = getPool();
    const val = active[prop];
    if (typeof val === 'function') {
      return val.bind(active);
    }
    return val;
  },
});

function prepare(sql, params = []) {
  const ordered = [];
  let text = sql.replace(/\$(\d+)/g, (match, index) => {
    ordered.push(params[Number(index) - 1]);
    return '?';
  });
  text = text.replace(/"([a-zA-Z0-9_]+)"/g, '`$1`');
  return { text, values: ordered.length ? ordered : params };
}

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

async function query(text, params) {
  const prepared = prepare(text, params);
  const [rows] = await pool.query(prepared.text, prepared.values);
  return { rows: normalizeRows(rows), result: rows };
}

async function connect() {
  const connection = await pool.getConnection();
  return {
    query: async (text, params) => {
      const prepared = prepare(text, params);
      const [rows] = await connection.query(prepared.text, prepared.values);
      return { rows: normalizeRows(rows), result: rows };
    },
    beginTransaction: () => connection.beginTransaction(),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
    release: () => connection.release(),
  };
}

module.exports = {
  query,
  connect,
  pool,
};
