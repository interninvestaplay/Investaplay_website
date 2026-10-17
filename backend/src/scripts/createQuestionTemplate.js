const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const category = String(process.argv[2] || '').trim();
const outputPath = category
  ? path.resolve(__dirname, '../../templates/category-templates', `${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-questions.xlsx`)
  : path.resolve(__dirname, '../../templates/question-import-template.xlsx');

const rows = [];

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.json_to_sheet(rows, {
  header: [
    'level',
    'category',
    'difficulty',
    'prompt',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'correct_option',
    'hint',
    'explanation',
    'time_limit_seconds',
  ],
});

worksheet['!cols'] = [
  { wch: 8 },
  { wch: 16 },
  { wch: 12 },
  { wch: 46 },
  { wch: 22 },
  { wch: 22 },
  { wch: 22 },
  { wch: 22 },
  { wch: 16 },
  { wch: 52 },
  { wch: 52 },
  { wch: 18 },
];

XLSX.utils.book_append_sheet(workbook, worksheet, 'Questions');

if (category) {
  const instructions = XLSX.utils.aoa_to_sheet([
    ['Question upload template'],
    ['Category', category],
    [],
    ['How to use'],
    ['1. Add one question per row in the Questions sheet.'],
    [`2. Set the category column to exactly: ${category}`],
    ['3. difficulty must be easy, medium, or hard.'],
    ['4. correct_option must be A, B, C, D, or the exact option text.'],
    ['5. Add a helpful clue in the optional hint column. It appears after a player uses the Hint power-up.'],
    ['6. Delete this Instructions sheet only if you want; it is ignored during upload.'],
  ]);
  instructions['!cols'] = [{ wch: 90 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
XLSX.writeFile(workbook, outputPath);
console.log(`Created ${outputPath}`);
