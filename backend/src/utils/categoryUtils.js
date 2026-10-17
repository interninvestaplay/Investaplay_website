function normalizeCategoryName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'General';
  }

  const synonyms = {
    general: 'General',
    'general knowledge': 'General',
    maths: 'Mathematics',
    math: 'Mathematics',
    mathematics: 'Mathematics',
    science: 'Science',
    'computer science': 'Technology',
    tech: 'Technology',
    technology: 'Technology',
    history: 'History',
    sports: 'Sports',
    sport: 'Sports',
    geography: 'Geography',
    literature: 'Literature',
    entertainment: 'Entertainment',
    movies: 'Entertainment',
    music: 'Entertainment',
    tv: 'Entertainment',
  };

  const lowered = raw.toLowerCase();
  if (synonyms[lowered]) {
    return synonyms[lowered];
  }

  return raw.replace(/\s+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function getCategoryMatchKey(value) {
  return normalizeCategoryName(value).toLowerCase();
}

function getCategorySearchValues(value) {
  const normalized = normalizeCategoryName(value);
  const values = new Set([
    normalized.toLowerCase(),
    String(value || '').trim().toLowerCase(),
    normalized.replace(/\s+/g, ' ').trim(),
    normalized.replace(/\s+/g, '_').toLowerCase(),
  ]);

  if (normalized === 'General') {
    values.add('general knowledge');
    values.add('general');
  }

  if (normalized === 'Mathematics') {
    values.add('math');
    values.add('maths');
  }

  if (normalized === 'Technology') {
    values.add('computer science');
    values.add('tech');
  }

  if (normalized === 'Sports') {
    values.add('sport');
  }

  if (normalized === 'Entertainment') {
    values.add('movies');
    values.add('music');
    values.add('tv');
  }

  return Array.from(values).filter(Boolean);
}

module.exports = {
  normalizeCategoryName,
  getCategoryMatchKey,
  getCategorySearchValues,
};
