/**
 * Groq AI Provider — implements the AI provider interface for quiz generation.
 *
 * This module communicates with the Groq API. The rest of the application
 * should NEVER import this file directly — always go through aiQuiz.service.js.
 *
 * Groq API key lives ONLY on the backend (.env), never exposed to the client.
 */

const env = require('../../../config/env');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Send a prompt to Groq and return the raw text response.
 * @param {string} prompt - The full prompt string
 * @param {object} [options]
 * @param {number} [options.temperature=0.7]
 * @param {number} [options.maxTokens=4096]
 * @param {number} [options.timeoutMs=60000]
 * @returns {Promise<string>} Raw text response from the model
 */
async function generateCompletion(prompt, options = {}) {
  const apiKey = env.groqApiKey;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured. Set it in your .env file.');
  }

  const model = env.groqModel || 'qwen/qwen3.8-27b';
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 4096;
  const timeoutMs = options.timeoutMs ?? 60000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a precise quiz question generator. You ONLY output valid JSON. Never include markdown, code fences, or explanatory text outside the JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const status = response.status;

      if (status === 429) {
        throw Object.assign(new Error('AI service rate limit exceeded. Please try again in a few moments.'), { code: 'RATE_LIMIT', status: 429 });
      }
      if (status === 401 || status === 403) {
        throw Object.assign(new Error('AI service authentication failed. Check server configuration.'), { code: 'AUTH_FAILED', status });
      }
      throw Object.assign(new Error(`AI service error (HTTP ${status})`), { code: 'PROVIDER_ERROR', status, detail: errorBody });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      throw Object.assign(new Error('AI returned an empty response'), { code: 'EMPTY_RESPONSE' });
    }

    return content;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      throw Object.assign(new Error('AI generation timed out. Please try again.'), { code: 'TIMEOUT' });
    }
    // Re-throw our own coded errors
    if (err.code) throw err;
    // Network / unexpected errors
    throw Object.assign(new Error('Failed to connect to AI service'), { code: 'NETWORK_ERROR', cause: err });
  }
}

/**
 * Get provider metadata for logging/diagnostics.
 */
function getProviderInfo() {
  return {
    provider: 'groq',
    model: env.groqModel || 'qwen/qwen3.8-27b',
  };
}

module.exports = {
  generateCompletion,
  getProviderInfo,
};
