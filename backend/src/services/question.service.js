const { randomUUID } = require('crypto');
const XLSX = require('xlsx');
const { query, connect } = require('../db/pool');

const requiredColumns = [
  'level',
  'category',
  'difficulty',
  'prompt',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'correct_option',
];

function normalizeDifficulty(value) {
  const difficulty = String(value || '').trim().toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new Error(`Invalid difficulty "${value}". Use easy, medium, or hard.`);
  }
  return difficulty;
}

function normalizeCorrectOption(rawCorrect, options) {
  const value = String(rawCorrect ?? '').trim();
  const letter = value.toUpperCase();
  if (/^[A-D]$/.test(letter)) {
    return options[letter.charCodeAt(0) - 65];
  }

  const matchingOption = options.find((option) => option.toLocaleLowerCase() === value.toLocaleLowerCase());
  if (!matchingOption) {
    throw new Error('correct_option must be A, B, C, or D (or match an option value).');
  }

  return matchingOption;
}

function rowsFromWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets.Questions || workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error('Workbook must include a Questions sheet.');
  }
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function validateQuestionRows(rows) {
  return rows
    .map((rawRow, index) => ({ rawRow, rowNumber: index + 2 }))
    .filter(({ rawRow }) => Object.values(rawRow).some((value) => String(value).trim()))
    .map(({ rawRow, rowNumber }) => {
      const row = Object.fromEntries(
        Object.entries(rawRow).map(([key, value]) => [String(key).trim().toLowerCase(), value]),
      );

      for (const column of requiredColumns) {
        if (!String(row[column] ?? '').trim()) {
          throw validationError(`Row ${rowNumber}: missing ${column}`);
        }
      }

      const level = Number(row.level);
      if (!Number.isInteger(level) || level < 1) {
        throw validationError(`Row ${rowNumber}: level must be a positive whole number`);
      }

      const options = [
        String(row.option_a ?? '').trim(),
        String(row.option_b ?? '').trim(),
        String(row.option_c ?? '').trim(),
        String(row.option_d ?? '').trim(),
      ];
      const uniqueOptions = new Set(options.map((option) => option.toLocaleLowerCase()));
      if (uniqueOptions.size !== options.length) {
        throw validationError(`Row ${rowNumber}: answer options must be unique`);
      }

      const timeLimitSeconds = Number(row.time_limit_seconds || 20);
      if (!Number.isInteger(timeLimitSeconds) || timeLimitSeconds < 5 || timeLimitSeconds > 120) {
        throw validationError(`Row ${rowNumber}: time_limit_seconds must be a whole number from 5 to 120`);
      }

      let difficulty;
      let correctOption;
      try {
        difficulty = normalizeDifficulty(row.difficulty);
        correctOption = normalizeCorrectOption(row.correct_option, options);
      } catch (error) {
        throw validationError(`Row ${rowNumber}: ${error.message}`);
      }

      return {
        level,
        category: String(row.category).trim(),
        difficulty,
        prompt: String(row.prompt).trim(),
        options,
        correctOption,
        explanation: String(row.hint || row.explanation || '').trim() || null,
        timeLimitSeconds,
      };
    });
}

async function upsertQuestions(questions) {
  let inserted = 0;
  let updated = 0;

  for (const item of questions) {
    // The schema's prefix unique index cannot reliably detect case/whitespace
    // variants, so use a normalized comparison before upserting.
    const existing = await query(
      'SELECT id FROM questions WHERE LOWER(TRIM(prompt)) = LOWER(TRIM($1)) LIMIT 1',
      [item.prompt]
    );
    await query(
      `INSERT INTO categories (id, name)
       VALUES ($1, $2)
       ON DUPLICATE KEY UPDATE status = 'active', updated_at = NOW()`,
      [randomUUID(), item.category],
    );
    if (existing.rows[0]) {
      await query(
        `UPDATE questions
         SET level = $1, category = $2, difficulty = $3, prompt = $4,
             options = CAST($5 AS JSON), correct_option = $6, explanation = $7, time_limit_seconds = $8
         WHERE id = $9`,
        [item.level, item.category, item.difficulty, item.prompt, JSON.stringify(item.options), item.correctOption, item.explanation, item.timeLimitSeconds, existing.rows[0].id],
      );
    } else await query(
      `INSERT INTO questions
        (id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds)
       VALUES ($1, $2, $3, $4, $5, CAST($6 AS JSON), $7, $8, $9)
       `,
      [
        randomUUID(),
        item.level,
        item.category,
        item.difficulty,
        item.prompt,
        JSON.stringify(item.options),
        item.correctOption,
        item.explanation,
        item.timeLimitSeconds,
      ],
    );
    if (existing.rows[0]) {
      updated += 1;
    } else {
      inserted += 1;
    }
  }

  return { inserted, updated, total: questions.length };
}

async function importQuestionsFromBuffer(buffer) {
  const rows = rowsFromWorkbook(buffer);
  const questions = validateQuestionRows(rows);
  if (questions.length === 0) {
    throw new Error('No question rows found.');
  }
  return upsertQuestions(questions);
}

async function listCategories({ includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT c.name AS category,
            c.description,
            c.status,
            COUNT(q.id) AS question_count,
            MIN(q.level) AS min_level,
            MAX(q.level) AS max_level
     FROM categories c
     LEFT JOIN questions q ON q.category = c.name
     ${includeInactive ? '' : "WHERE c.status = 'active'"}
     GROUP BY c.id, c.name, c.description, c.status
     ORDER BY c.name ASC`
  );
  return rows;
}

async function createCategory(name, description, userId) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    const error = new Error('Category name is required');
    error.status = 400;
    throw error;
  }

  const existing = await query('SELECT * FROM categories WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1', [cleanName]);
  if (existing.rows[0]) {
    await query(
      `UPDATE categories SET name = $1, description = COALESCE($2, description), status = 'active', updated_at = NOW() WHERE id = $3`,
      [cleanName, description || null, existing.rows[0].id],
    );
    return (await query('SELECT * FROM categories WHERE id = $1', [existing.rows[0].id])).rows[0];
  }

  await query(
    `INSERT INTO categories (id, name, description, created_by)
     VALUES ($1, $2, $3, $4)
     ON DUPLICATE KEY UPDATE
       description = VALUES(description),
       status = 'active',
       updated_at = NOW()`,
    [randomUUID(), cleanName, description || null, userId]
  );

  const { rows } = await query('SELECT * FROM categories WHERE name = $1', [cleanName]);
  return rows[0];
}

async function updateCategory(categoryName, { name, description, status }) {
  const oldName = decodeURIComponent(categoryName).trim();
  const cleanName = String(name || oldName).trim();
  if (!cleanName) {
    const error = new Error('Category name is required'); error.status = 400; throw error;
  }
  if (status && !['active', 'hidden', 'inactive'].includes(status)) {
    const error = new Error('Category status must be active or hidden'); error.status = 400; throw error;
  }
  const cleanStatus = status === 'inactive' ? 'hidden' : status;
  const client = await connect();
  try {
    await client.beginTransaction();
    const category = await client.query('SELECT * FROM categories WHERE name = $1 FOR UPDATE', [oldName]);
    if (!category.rows[0]) { const error = new Error('Category not found'); error.status = 404; throw error; }
    const duplicate = await client.query('SELECT id FROM categories WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND id != $2 LIMIT 1', [cleanName, category.rows[0].id]);
    if (duplicate.rows[0]) { const error = new Error('A category with this name already exists'); error.status = 409; throw error; }
    await client.query('UPDATE categories SET name = $1, description = $2, status = $3, updated_at = NOW() WHERE id = $4', [cleanName, description ?? category.rows[0].description, cleanStatus || category.rows[0].status, category.rows[0].id]);
    if (cleanName !== oldName) {
      // These tables use the category name by design. Keep present and historical
      // records internally consistent without changing the schema contract.
      for (const table of ['questions', 'tournaments', 'rooms', 'user_match_history']) {
        try { await client.query(`UPDATE ${table} SET category = $1 WHERE category = $2`, [cleanName, oldName]); } catch (_) {}
      }
    }
    await client.commit();
    return (await query('SELECT * FROM categories WHERE id = $1', [category.rows[0].id])).rows[0];
  } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
}

async function deleteCategory(categoryName) {
  const cleanName = decodeURIComponent(categoryName).trim();
  const dependencies = await query(
    `SELECT
       (SELECT COUNT(*) FROM questions WHERE category = $1) AS question_count,
       (SELECT COUNT(*) FROM tournaments WHERE category = $1) AS tournament_count,
       (SELECT COUNT(*) FROM rooms WHERE category = $1) AS room_count`,
    [cleanName],
  );
  if (!dependencies.rows[0]) { const error = new Error('Category not found'); error.status = 404; throw error; }

  const questionCount = Number(dependencies.rows[0].question_count || 0);
  const tournamentCount = Number(dependencies.rows[0].tournament_count || 0);
  const roomCount = Number(dependencies.rows[0].room_count || 0);
  const totalDeps = questionCount + tournamentCount + roomCount;

  if (totalDeps === 0) {
    // Permanently remove unused/empty category from database
    await query('DELETE FROM categories WHERE name = $1', [cleanName]);
    return { success: true, deleted: true, deactivatedCategory: cleanName, dependencies: dependencies.rows[0] };
  }

  // Categories with existing questions/tournaments are archived/hidden to preserve integrity
  await query("UPDATE categories SET status = 'hidden', updated_at = NOW() WHERE name = $1", [cleanName]);
  return { success: true, deleted: false, deactivatedCategory: cleanName, dependencies: dependencies.rows[0] };
}

async function listQuestions(level, category) {
  const { rows } = await query(
    `SELECT id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds
     FROM questions
     WHERE ($1 IS NULL OR level = $1)
       AND ($2 IS NULL OR category = $2)
     ORDER BY level ASC, category ASC, created_at DESC
     LIMIT 200`,
    [level ? Number(level) : null, category || null],
  );
  return rows;
}

async function createQuestion({
  level = 1,
  category = 'General',
  difficulty = 'easy',
  prompt,
  options,
  correctOption,
  explanation,
  timeLimitSeconds = 15,
}, userId) {
  const cleanedOptions = Array.isArray(options)
    ? options.map((option) => String(option).trim()).filter(Boolean)
    : [];

  if (!prompt || cleanedOptions.length < 2 || !correctOption) {
    const error = new Error('prompt, at least 2 options, and correctOption are required');
    error.status = 400;
    throw error;
  }

  if (!cleanedOptions.includes(String(correctOption).trim())) {
    const error = new Error('correctOption must match one of the options');
    error.status = 400;
    throw error;
  }

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    const error = new Error('difficulty must be easy, medium, or hard');
    error.status = 400;
    throw error;
  }

  const id = randomUUID();
  const cleanCategory = String(category || 'General').trim();
  await query(
    `INSERT INTO categories (id, name, created_by)
     VALUES ($1, $2, $3)
     ON DUPLICATE KEY UPDATE status = 'active', updated_at = NOW()`,
    [randomUUID(), cleanCategory, userId]
  );

  await query(
    `INSERT INTO questions
       (id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds)
     VALUES ($1, $2, $3, $4, $5, CAST($6 AS JSON), $7, $8, $9)`,
    [
      id,
      Number(level) || 1,
      cleanCategory,
      difficulty,
      String(prompt).trim(),
      JSON.stringify(cleanedOptions),
      String(correctOption).trim(),
      explanation || null,
      Number(timeLimitSeconds) || 15,
    ]
  );

  const { rows } = await query(
    `SELECT id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds
     FROM questions
     WHERE id = $1`,
    [id]
  );
  return rows[0];
}

async function deleteQuestion(questionId) {
  await query('DELETE FROM questions WHERE id = $1', [questionId]);
  return { success: true, deletedQuestionId: questionId };
}

async function updateQuestion(questionId, {
  level = 1,
  category = 'General',
  difficulty = 'easy',
  prompt,
  options,
  correctOption,
  explanation,
  timeLimitSeconds = 15,
}, userId) {
  const cleanedOptions = Array.isArray(options)
    ? options.map((option) => String(option).trim()).filter(Boolean)
    : [];
  const normalizedCorrectOption = String(correctOption || '').trim().toLocaleLowerCase();
  const matchingCorrectOption = cleanedOptions.find(
    (option) => option.toLocaleLowerCase() === normalizedCorrectOption,
  ) || (/^\d+$/.test(normalizedCorrectOption)
    ? cleanedOptions[Number(normalizedCorrectOption) - 1]
    : undefined);

  if (!prompt || cleanedOptions.length < 2 || !matchingCorrectOption) {
    const error = new Error('prompt, at least 2 options, and a matching correctOption are required');
    error.status = 400;
    throw error;
  }
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    const error = new Error('difficulty must be easy, medium, or hard');
    error.status = 400;
    throw error;
  }

  const cleanCategory = String(category || 'General').trim();
  await query(
    `UPDATE questions
     SET level = $1, category = $2, difficulty = $3, prompt = $4,
       options = $5, correct_option = $6, explanation = $7,
       time_limit_seconds = $8
     WHERE id = $9`,
    [Number(level) || 1, cleanCategory, difficulty, String(prompt).trim(), JSON.stringify(cleanedOptions), matchingCorrectOption, explanation || null, Number(timeLimitSeconds) || 15, questionId],
  );

  const { rows } = await query(
    `SELECT id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds
     FROM questions WHERE id = $1`,
    [questionId],
  );
  if (!rows[0]) {
    const error = new Error('Question not found');
    error.status = 404;
    throw error;
  }
  return rows[0];
}

module.exports = {
  importQuestionsFromBuffer,
  rowsFromWorkbook,
  validateQuestionRows,
  upsertQuestions,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
};
