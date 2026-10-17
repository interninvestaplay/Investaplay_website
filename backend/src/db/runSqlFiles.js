const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

async function executeSqlFile(connection, filePath) {
  const relativeFile = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  const sql = fs.readFileSync(filePath, 'utf8');

  if (relativeFile.endsWith('migrations/005_challenges.sql')) {
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
    // Split statements and execute individually to handle column-exists errors
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const statement of statements) {
      try {
        await connection.query(statement);
      } catch (error) {
        // Ignore duplicate column errors (ER_DUP_FIELDNAME = 1060)
        // Ignore duplicate index errors (ER_DUP_KEYNAME = 1061)
        // Ignore multiple primary key errors (ER_MULTIPLE_PRI_KEY = 1068)
        // Ignore cannot drop index/field errors if it does not exist (ER_CANT_DROP_FIELD_OR_KEY = 1091)
        if (['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_MULTIPLE_PRI_KEY', 'ER_CANT_DROP_FIELD_OR_KEY'].includes(error.code)) {
          continue;
        }
        throw error;
      }
    }
  }

  console.log(`Executed ${relativeFile}`);
}

async function main() {
  const relativePath = process.argv[2];
  if (!relativePath) {
    throw new Error('Usage: node src/db/runSqlFiles.js <sql-file-or-dir>');
  }

  const target = path.resolve(process.cwd(), relativePath);
  const stats = fs.statSync(target);

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

    let sqlFiles = [];
    if (stats.isDirectory()) {
      sqlFiles = fs.readdirSync(target)
        .filter((file) => file.toLowerCase().endsWith('.sql') && file !== '002_seed_data.sql')
        .sort()
        .map((file) => path.join(target, file));
    } else {
      sqlFiles = [target];
    }

    for (const file of sqlFiles) {
      await executeSqlFile(connection, file);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});