/**
 * PDF text extraction service for Quick Quiz.
 *
 * Handles: validation, text extraction, cleaning, and chunking.
 * Extracted text stays server-side — never sent back to the mobile app.
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract text from a PDF file.
 * Uses pdf-parse library for text extraction.
 *
 * @param {string} filePath - Absolute path to the uploaded PDF
 * @returns {Promise<{ text: string, pageCount: number, metadata: object }>}
 */
async function extractTextFromPdf(filePath) {
  // Dynamic import to avoid breaking if pdf-parse isn't installed yet
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    throw Object.assign(
      new Error('PDF processing is not available. Please install pdf-parse.'),
      { code: 'PDF_PARSER_MISSING' }
    );
  }

  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('PDF file not found'), { code: 'FILE_NOT_FOUND' });
  }

  const buffer = fs.readFileSync(filePath);

  // Validate it's actually a PDF (check magic bytes: %PDF)
  if (buffer.length < 5 || buffer.toString('ascii', 0, 5) !== '%PDF-') {
    throw Object.assign(new Error('File is not a valid PDF'), { code: 'INVALID_PDF' });
  }

  try {
    let rawText = '';
    let pageCount = 0;
    let info = {};

    if (typeof pdfParse === 'function') {
      const data = await pdfParse(buffer);
      rawText = data.text || '';
      pageCount = data.numpages || 0;
      info = data.info || {};
    } else if (pdfParse.PDFParse) {
      const parser = new pdfParse.PDFParse(new Uint8Array(buffer));
      await parser.load();
      const textResult = await parser.getText();
      rawText = typeof textResult === 'string' ? textResult : (textResult?.text || '');
      const docInfo = await parser.getInfo?.();
      pageCount = docInfo?.total || 0;
      info = docInfo?.info || {};
    } else if (pdfParse.default && typeof pdfParse.default === 'function') {
      const data = await pdfParse.default(buffer);
      rawText = data.text || '';
      pageCount = data.numpages || 0;
      info = data.info || {};
    } else {
      throw new Error('Unsupported pdf-parse export format');
    }

    const text = cleanText(rawText);

    if (text.length < 50) {
      throw Object.assign(
        new Error('PDF contains insufficient text for quiz generation. Please upload a PDF with more content.'),
        { code: 'INSUFFICIENT_TEXT' }
      );
    }

    return {
      text,
      pageCount,
      metadata: {
        title: info?.Title || null,
        author: info?.Author || null,
        pageCount,
        charCount: text.length,
      },
    };
  } catch (err) {
    if (err.code) throw err; // Re-throw our coded errors
    throw Object.assign(
      new Error('Failed to read PDF. The file may be corrupted or password-protected.'),
      { code: 'PDF_PARSE_ERROR', cause: err }
    );
  }
}

/**
 * Clean extracted PDF text.
 * Removes excessive whitespace, special characters, headers/footers patterns.
 */
function cleanText(text) {
  return text
    .replace(/\f/g, '\n')                    // form feeds → newlines
    .replace(/\r\n/g, '\n')                  // normalize line endings
    .replace(/[ \t]+/g, ' ')                 // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')              // collapse excessive blank lines
    .replace(/^\s*Page \d+\s*$/gm, '')       // remove page number lines
    .replace(/^\s*\d+\s*$/gm, '')            // remove standalone numbers (page numbers)
    .trim();
}

/**
 * Split text into chunks for processing very large PDFs.
 * Each chunk aims to be self-contained enough for question generation.
 *
 * @param {string} text
 * @param {number} [maxChunkSize=8000] - Characters per chunk
 * @param {number} [overlap=500] - Overlap between chunks for context continuity
 * @returns {{ chunks: { text: string, startChar: number, endChar: number, chunkIndex: number }[] }}
 */
function chunkText(text, maxChunkSize = 8000, overlap = 500) {
  if (text.length <= maxChunkSize) {
    return {
      chunks: [{ text, startChar: 0, endChar: text.length, chunkIndex: 0 }],
    };
  }

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChunkSize, text.length);

    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      const sentenceBreak = text.lastIndexOf('. ', end);

      if (paragraphBreak > start + maxChunkSize * 0.5) {
        end = paragraphBreak + 2;
      } else if (sentenceBreak > start + maxChunkSize * 0.5) {
        end = sentenceBreak + 2;
      }
    }

    chunks.push({
      text: text.slice(start, end).trim(),
      startChar: start,
      endChar: end,
      chunkIndex,
    });

    start = end - overlap;
    if (start >= text.length) break;
    chunkIndex++;
  }

  return { chunks };
}

/**
 * Clean up a temporary uploaded file.
 * @param {string} filePath
 */
function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Non-critical — log but don't throw
    console.warn(`[QuickQuiz] Failed to cleanup temp file: ${filePath}`);
  }
}

module.exports = {
  extractTextFromPdf,
  cleanText,
  chunkText,
  cleanupFile,
};
