const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

async function main() {
  const relativeFile = process.argv[2];
  if (!relativeFile) {
    throw new Error('Usage: node src/db/runSqlFile.js <sql-file>');
  }

  const file = path.resolve(process.cwd(), relativeFile);
  const sql = fs.readFileSync(file, 'utf8');
  const connection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    multipleStatements: true,
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.dbName}\``);
    await connection.query(`USE \`${env.dbName}\``);
    if (relativeFile.replace(/\\/g, '/').endsWith('migrations/005_challenges.sql')) {
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'users'
           AND COLUMN_NAME = 'invite_code'`
      );
      if (columns.length) {
        await connection.query(sql.replace(/^ALTER TABLE users ADD COLUMN invite_code VARCHAR\(12\) NULL UNIQUE;\s*/i, ''));
      } else {
        await connection.query(sql);
      }
    } else {
      await connection.query(sql);
    }
    console.log(`Executed ${relativeFile}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
