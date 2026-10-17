const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const dirsToCheck = ['controllers', 'routes', 'services', 'db', 'sockets', 'config', 'utils', 'scripts'];
let checkedCount = 0;

function checkFile(filePath) {
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
    checkedCount++;
  } catch (err) {
    console.error(`Syntax error in ${filePath}:`, err.stderr?.toString() || err.message);
    process.exit(1);
  }
}

// Check root server.js
checkFile(path.join(rootDir, 'server.js'));

// Check subdirectories
for (const dir of dirsToCheck) {
  const dirPath = path.join(rootDir, dir);
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      checkFile(path.join(dirPath, file));
    }
  }
}

console.log(`[Syntax Check Passed]: Checked ${checkedCount} backend JS files with 0 errors.`);
