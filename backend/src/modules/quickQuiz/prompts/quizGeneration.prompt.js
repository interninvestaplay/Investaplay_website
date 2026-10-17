/**
 * Structured prompts for AI quiz generation.
 * Kept separate so prompts can be tuned without touching business logic.
 */

function buildTopicPrompt({ topic, difficulty, questionCount, existingConceptKeys = [] }) {
  const exclusionBlock = existingConceptKeys.length > 0
    ? `\nALREADY USED concept keys (DO NOT repeat these concepts):\n${existingConceptKeys.map(k => `- ${k}`).join('\n')}\n`
    : '';

  return `You are a professional quiz question generator.

Generate exactly ${questionCount} multiple-choice quiz questions about "${topic}" at "${difficulty}" difficulty level.
${exclusionBlock}
RULES:
1. Return ONLY valid JSON — no markdown, no code fences, no explanation text.
2. Each question must have exactly 4 options.
3. CRITICAL: The correct option position MUST be randomly and evenly distributed among indices 0, 1, 2, and 3 (corresponding to A, B, C, D). Do NOT always place the correct answer at index 0!
4. Exactly one option must be correct, indicated by "correctOption" (0-based integer index: 0, 1, 2, or 3).
5. Every question must include a short "hint" — a subtle, helpful clue that assists the player without revealing the exact answer.
6. Every question must include a brief "explanation" of why the correct answer is right.
7. Every question must include a unique "conceptKey" — a lowercase snake_case identifier describing the specific concept tested (e.g., "javascript_closure_scope", "aws_iam_purpose").
8. No two questions should test the same concept.
9. Do not invent facts. All questions must be factually accurate.
10. Questions and options must be clear, concise, and unambiguous.
11. Options should be plausible — no obviously joke answers.
12. Match the requested difficulty:
    - easy: Fundamental concepts, direct recall
    - medium: Applied understanding, comparison, moderate reasoning
    - hard: Advanced concepts, edge cases, deep analysis
13. Do not include any text before or after the JSON object.

RESPONSE FORMAT (strict JSON):
{
  "questions": [
    {
      "question": "What is ...?",
      "options": ["First Option", "Second Option", "Third Option", "Fourth Option"],
      "correctOption": 1,
      "hint": "Think about the primary role of ...",
      "explanation": "Because ...",
      "difficulty": "${difficulty}",
      "conceptKey": "topic_specific_concept"
    }
  ]
}`;
}

function buildPdfPrompt({ pdfText, difficulty, questionCount, existingConceptKeys = [] }) {
  const exclusionBlock = existingConceptKeys.length > 0
    ? `\nALREADY USED concept keys (DO NOT repeat these concepts):\n${existingConceptKeys.map(k => `- ${k}`).join('\n')}\n`
    : '';

  // Truncate extremely large PDFs to avoid token limits
  const maxChars = 30000;
  const trimmedText = pdfText.length > maxChars
    ? pdfText.slice(0, maxChars) + '\n\n[... content truncated for length ...]'
    : pdfText;

  return `You are a professional quiz question generator.

Generate exactly ${questionCount} multiple-choice quiz questions based ONLY on the following document content. Do NOT use any external or general knowledge — every question and answer must be directly grounded in the provided text.
${exclusionBlock}
DOCUMENT CONTENT:
---
${trimmedText}
---

RULES:
1. Return ONLY valid JSON — no markdown, no code fences, no explanation text.
2. Each question must have exactly 4 options.
3. CRITICAL: The correct option position MUST be randomly and evenly distributed among indices 0, 1, 2, and 3 (corresponding to A, B, C, D). Do NOT always place the correct answer at index 0!
4. Exactly one option must be correct, indicated by "correctOption" (0-based integer index: 0, 1, 2, or 3).
5. Every question must include a short "hint" — a subtle clue referencing the document context.
6. Every question must include a brief "explanation" referencing the document content.
7. Every question must include a unique "conceptKey" — a lowercase snake_case identifier for the specific concept tested.
8. No two questions should test the same concept.
9. ALL information must come from the provided document. Do NOT invent or assume facts not present in the text.
10. Questions and options must be clear, concise, and unambiguous.
11. Match the requested difficulty:
    - easy: Direct recall from text
    - medium: Comprehension and inference from text
    - hard: Analysis, comparison, and synthesis from text
12. Do not include any text before or after the JSON object.

RESPONSE FORMAT (strict JSON):
{
  "questions": [
    {
      "question": "According to the document, what is ...?",
      "options": ["First Option", "Second Option", "Third Option", "Fourth Option"],
      "correctOption": 2,
      "hint": "Look closely at the section discussing ...",
      "explanation": "The document states that ...",
      "difficulty": "${difficulty}",
      "conceptKey": "document_specific_concept"
    }
  ]
}`;
}

module.exports = {
  buildTopicPrompt,
  buildPdfPrompt,
};
