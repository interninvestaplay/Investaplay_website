const fs = require('fs');
const path = require('path');
const { importQuestionsFromBuffer } = require('../services/question.service');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: npm run questions:import -- path/to/questions.xlsx');
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  const result = await importQuestionsFromBuffer(fs.readFileSync(absolutePath));
  console.log(`Imported ${result.total} questions (${result.inserted} new, ${result.updated} updated).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
