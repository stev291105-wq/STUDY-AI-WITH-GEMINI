import type { UploadedDoc } from '../types.ts';

export const SPANISH_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en',
  'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hacia', 'hasta', 'desde', 'según',
  'segun', 'como', 'que', 'qué', 'cual', 'cuál', 'cuales', 'cuáles', 'quien', 'quién',
  'donde', 'dónde', 'cuando', 'cuándo', 'cuanto', 'cuánto', 'este', 'esta', 'estos',
  'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'aquellos', 'aquellas',
  'esto', 'eso', 'aquello', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nuestro', 'nuestra',
  'y', 'e', 'o', 'u', 'ni', 'pero', 'sino', 'aunque', 'porque', 'pues', 'ya', 'si',
  'sí', 'no', 'también', 'tambien', 'así', 'asi', 'más', 'mas', 'menos', 'muy', 'tan',
  'tanto', 'toda', 'todo', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras', 'mismo',
  'misma', 'cada', 'cualquier', 'alguno', 'alguna', 'algunos', 'algunas', 'ninguno',
  'ninguna', 'ser', 'es', 'son', 'era', 'eran', 'fue', 'fueron', 'sea', 'sean', 'sido',
  'estar', 'está', 'esta', 'están', 'estan', 'estaba', 'haber', 'ha', 'han', 'había',
  'hay', 'tener', 'tiene', 'tienen', 'tenía', 'hacer', 'hace', 'hacen', 'puede', 'pueden',
  'podría', 'debe', 'deben', 'se', 'le', 'les', 'lo', 'me', 'te', 'nos', 'os', 'uno',
  'dos', 'tres', 'parte', 'tipo', 'forma', 'manera', 'caso', 'ejemplo', 'través', 'traves',
  'durante', 'mediante', 'alcanzó', 'alcanzo', 'realiza', 'realizaba', 'caracteriza',
  'page', 'pagina', 'página', 'paginas', 'páginas', 'documento', 'archivo', 'resumen',
  'oral', 'capítulo', 'capitulo', 'diapositiva', 'slide', 'nota', 'notas', 'tema', 'temas'
]);

/**
 * Checks whether a word exhibits PDF CMap collision corruption, OCR gibberish, or invalid Spanish structure.
 * Specifically catches artifacts like "sicodiagnósticoAyAEntM", "eNista", "ageA", "AofA", "C5".
 */
export function isCorruptedToken(word: string): boolean {
  if (!word) return true;
  const clean = word.replace(/^[.,;:"'«»()[\]¿?¡!\-]+|[.,;:"'«»()[\]¿?¡!\-]+$/g, '');
  if (!clean) return true;

  // Reject tokens mixing letters and digits unless standard biochemical/technical terms (e.g. CO2, H2O, G3P, C3, FADH2, NADH)
  if (/\d/.test(clean) && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(clean)) {
    const allowedTech = /^(CO2|H2O|O2|G3P|3-PGA|C3|C4|FADH2|NADH|NADPH|ATP|ADN|ARN|C6H12O6|d_k|v1|v2)$/i;
    if (!allowedTech.test(clean)) return true;
  }

  // Reject any word with lowercase followed immediately by uppercase (e.g. "sicodiagnósticoAyAEntM", "eNista", "ageA", "AofA")
  if (/[a-záéíóúüñ][A-ZÁÉÍÓÚÜÑ]/.test(clean)) {
    const allowedAcronym = /^(RuBisCO|RoPE|LaTeX|PowerPoint|OpenAI|DeepSeek|PageRank|JavaScript|TypeScript| WordPress)$/;
    if (!allowedAcronym.test(clean)) return true;
  }

  // Reject Uppercase + lowercase + Uppercase collisions (e.g. "AofA", "EntM")
  if (/[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+[A-ZÁÉÍÓÚÜÑ]/.test(clean)) {
    const allowedAcronym = /^(RuBisCO|RoPE|LaTeX|PowerPoint|OpenAI|DeepSeek)$/;
    if (!allowedAcronym.test(clean)) return true;
  }

  // Reject 2+ uppercase letters followed by lowercase (e.g. "APsicodiagnóstico")
  if (/^[A-ZÁÉÍÓÚÜÑ]{2,}[a-záéíóúüñ]+/.test(clean)) {
    return true;
  }

  // For purely alphabetical words >= 4 chars, check vowel ratio and consonant clusters
  const lettersOnly = clean.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (lettersOnly.length >= 4) {
    const vowels = (lettersOnly.match(/[aeiouáéíóúüAEIOUÁÉÍÓÚÜ]/g) || []).length;
    const ratio = vowels / lettersOnly.length;
    // Natural Spanish words have vowel ratio between 0.25 and 0.78
    if (ratio < 0.24 || ratio > 0.82) return true;
    // Reject 4+ consecutive consonants (rare/impossible in Spanish)
    if (/[bcdfghjklmnñpqrstvwxyzBCDFGHJKLMNÑPQRSTVWXYZ]{4,}/.test(lettersOnly)) return true;
    // Reject 3 identical consecutive letters
    if (/(.)\1\1/i.test(lettersOnly)) return true;
  }

  return false;
}

/**
 * Checks whether a word is a clean, meaningful Spanish study concept suitable for quiz questions and options.
 */
export function isValidSpanishStudyWord(word: string): boolean {
  if (!word) return false;
  const clean = word.trim().replace(/^[.,;:"'«»()[\]¿?¡!\-]+|[.,;:"'«»()[\]¿?¡!\-]+$/g, '');
  if (clean.length < 4 || clean.length > 34) return false;
  if (/^\d+$/.test(clean)) return false;
  if (SPANISH_STOPWORDS.has(clean.toLowerCase())) return false;
  if (isCorruptedToken(clean)) return false;

  // Must start with a valid letter
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(clean)) return false;

  // Reject broken word fragments from split PDF glyphs (e.g. "sicodiagnóstico" missing initial P, "eNista", "ageA")
  const lower = clean.toLowerCase();
  if (
    lower.startsWith('sicodiagn') ||
    lower === 'agea' ||
    lower === 'aofa' ||
    lower === 'enista' ||
    lower === 'entm' ||
    lower === 'page' ||
    lower === 'pagina'
  ) {
    return false;
  }

  return true;
}

/**
 * Repairs and sanitizes raw text extracted from PDFs or OCR, removing pagination headers/footers
 * and fixing CMap space-collision artifacts (such as 'A' injected in place of spaces).
 */
export function sanitizeAcademicText(raw: string): string {
  if (!raw) return '';

  let text = raw
    .replace(/\u0000/g, ' ')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\uFFFD+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // 1. Remove corrupted or standard PDF page headers/footers:
  // e.g., "P ageA 1 AofA C5", "Page 1 of 5", "Página 2 de 10", "- 3 -"
  text = text
    .replace(/\bP\s*age[A-Za-z0-9\s]*?\d+\s*[A-Za-z]*of[A-Za-z0-9\s]*?\b/gi, ' ')
    .replace(/\bPage\s+\d+\s*(?:of|\/)\s*\d+\b/gi, ' ')
    .replace(/\bP[áa]gina\s+\d+\s*(?:de|\/)\s*\d+\b/gi, ' ')
    .replace(/(?:^|\n)\s*[-–—]?\s*\d{1,3}\s*[-–—]?\s*(?=\n|$)/g, '\n');

  // 2. Repair PDF CMap space collisions where 'A' was mapped to space between words
  // e.g. ":AP sicodiagnósticoAyAEntM eNista" -> "Psicodiagnóstico y Entrevista"
  text = text
    .replace(/(?:^|\s)R\s*:\s*AP\s+sicodiagn[óo]sticoAyAEntM\s*eNista/gi, ' Psicodiagnóstico y Entrevista')
    .replace(/\bP\s+sicodiagn[óo]stico/gi, 'Psicodiagnóstico')
    .replace(/\bsicodiagn[óo]stico\b/gi, 'Psicodiagnóstico')
    .replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})AyA([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\b/g, '$1 y $2')
    .replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})AeA([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\b/g, '$1 e $2')
    .replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})AdeA([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\b/g, '$1 de $2')
    .replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})AenA([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\b/g, '$1 en $2')
    .replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})AconA([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\b/g, '$1 con $2')
    .replace(/\bEntM\s*eNista\b/gi, 'Entrevista');

  // 3. Rejoin hyphenated line breaks common in academic PDFs: "psico-\ndiagnóstico" -> "psicodiagnóstico"
  text = text.replace(/([a-záéíóúüñ])-\s*\n\s*([a-záéíóúüñ])/gi, '$1$2');

  // 4. Filter out individual lines that are predominantly corrupted tokens or noise
  const lines = text.split('\n');
  const cleanLines: string[] = [];

  for (const rawLine of lines) {
    // Strip leading isolated garbage prefixes like "R :" or ":AP"
    const line = rawLine
      .replace(/^\s*(?:R\s*:|:+\s*AP\b|[:;*•·\-–—]+\s*)/i, '')
      .replace(/[ \t]+/g, ' ')
      .trim();

    if (!line) {
      cleanLines.push('');
      continue;
    }

    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Count how many tokens in this line are corrupted
    let corruptedCount = 0;
    let validLongWords = 0;
    for (const w of words) {
      if (isCorruptedToken(w)) {
        corruptedCount++;
      } else if (w.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '').length >= 4) {
        validLongWords++;
      }
    }

    // If more than 30% of tokens on the line are corrupted CMap garbage, strip corrupted tokens or skip line
    if (corruptedCount / words.length > 0.3) {
      const salvaged = words.filter(w => !isCorruptedToken(w)).join(' ');
      if (salvaged.length >= 25 && validLongWords >= 3) {
        cleanLines.push(salvaged);
      }
      continue;
    }

    // Remove isolated corrupted tokens embedded in an otherwise valid line
    const filteredLine = words.filter(w => !isCorruptedToken(w) || w.length <= 2).join(' ');
    if (filteredLine.trim()) {
      cleanLines.push(filteredLine.trim());
    }
  }

  return cleanLines
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Validates whether a sentence is clean, natural Spanish prose suitable for turning into a study question.
 */
export function isCleanStudySentence(sentence: string): boolean {
  if (!sentence) return false;
  const trimmed = sentence.trim();
  if (trimmed.length < 25 || trimmed.length > 480) return false;

  // Reject sentences containing page numbers or CMap corruption patterns
  if (/\b(?:Page|P[áa]gina)\s+\d+/i.test(trimmed)) return false;
  if (/\bAofA\b|\bageA\b|\bsicodiagn[óo]sticoAyA/i.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 5) return false;

  let corrupted = 0;
  let validStudyWords = 0;
  for (const tok of tokens) {
    if (isCorruptedToken(tok)) {
      corrupted++;
    }
    if (isValidSpanishStudyWord(tok)) {
      validStudyWords++;
    }
  }

  // Must have zero CMap-corrupted words or < 10% noise, and at least 2 valid study concepts
  if (corrupted > 0 && corrupted / tokens.length > 0.08) return false;
  if (validStudyWords < 2) return false;

  return true;
}

/**
 * Checks whether a string looks like binary garbage (e.g. raw PDF/ZIP headers or high non-printable ratio).
 */
export function isBinaryGarbage(text: string): boolean {
  if (!text || !text.trim()) return true;
  const trimmed = text.trim();
  if (trimmed.startsWith('%PDF-') || trimmed.startsWith('PK\x03\x04')) {
    return true;
  }
  const sample = trimmed.slice(0, 2000);
  let unprintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 65533) {
      unprintable++;
    }
  }
  return unprintable / sample.length > 0.08;
}

/**
 * Cleans and normalizes extracted document text while keeping paragraph and sentence structure.
 */
export function cleanExtractedText(raw: string): string {
  return sanitizeAcademicText(raw);
}

/**
 * Decompresses a Uint8Array using Web Streams DecompressionStream ('deflate' or 'deflate-raw').
 */
async function decompressBytes(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || data.byteLength === 0) return null;
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    writer.write(data as unknown as BufferSource).catch(() => {});
    writer.close().catch(() => {});

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.byteLength;
      }
    }
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return totalLen > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Decompresses a PDF FlateDecode stream trying standard zlib deflate, stripped 2-byte header deflate-raw, and direct deflate-raw.
 */
async function decompressPdfStream(subBytes: Uint8Array): Promise<Uint8Array | null> {
  let out = await decompressBytes(subBytes, 'deflate');
  if (out) return out;
  if (subBytes.byteLength > 6) {
    out = await decompressBytes(subBytes.subarray(2, subBytes.byteLength - 4), 'deflate-raw');
    if (out) return out;
    out = await decompressBytes(subBytes.subarray(2), 'deflate-raw');
    if (out) return out;
  }
  return decompressBytes(subBytes, 'deflate-raw');
}

/**
 * Extracts XML files from a ZIP archive buffer (.docx, .pptx, .odt) using local file headers.
 */
async function extractZipXmlText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const extractedSections: Array<{ name: string; text: string }> = [];

  let i = 0;
  while (i < bytes.length - 30) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x03 &&
      bytes[i + 3] === 0x04
    ) {
      const compressionMethod = view.getUint16(i + 8, true);
      const compressedSize = view.getUint32(i + 18, true);
      const fileNameLength = view.getUint16(i + 26, true);
      const extraFieldLength = view.getUint16(i + 28, true);

      const fileNameBytes = bytes.subarray(i + 30, i + 30 + fileNameLength);
      const fileName = decoder.decode(fileNameBytes);
      const dataStart = i + 30 + fileNameLength + extraFieldLength;

      let dataEnd = dataStart + compressedSize;
      if (compressedSize === 0 || dataEnd > bytes.length) {
        let nextHeader = dataStart;
        while (nextHeader < bytes.length - 4) {
          if (
            bytes[nextHeader] === 0x50 &&
            bytes[nextHeader + 1] === 0x4b &&
            (bytes[nextHeader + 2] === 0x03 || bytes[nextHeader + 2] === 0x01 || bytes[nextHeader + 2] === 0x07)
          ) {
            break;
          }
          nextHeader++;
        }
        dataEnd = nextHeader;
      }

      const isRelevantXml =
        fileName === 'word/document.xml' ||
        fileName.startsWith('ppt/slides/slide') ||
        fileName.startsWith('ppt/notesSlides/notesSlide') ||
        fileName === 'content.xml';

      if (isRelevantXml && dataEnd > dataStart) {
        const compressedChunk = bytes.subarray(dataStart, dataEnd);
        let rawXmlBytes: Uint8Array | null = null;
        if (compressionMethod === 0) {
          rawXmlBytes = compressedChunk;
        } else if (compressionMethod === 8) {
          rawXmlBytes = await decompressBytes(compressedChunk, 'deflate-raw');
        }

        if (rawXmlBytes) {
          const xmlString = decoder.decode(rawXmlBytes);
          const cleaned = parseOfficeXmlToText(xmlString);
          if (cleaned.trim()) {
            extractedSections.push({ name: fileName, text: cleaned.trim() });
          }
        }
      }

      i = Math.max(i + 30, dataEnd);
    } else {
      i++;
    }
  }

  extractedSections.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return extractedSections.map(s => s.text).join('\n\n');
}

/**
 * Converts Word/PowerPoint/ODF XML content into clean paragraphs.
 */
function parseOfficeXmlToText(xml: string): string {
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<\/text:p>/g, '\n')
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Preprocesses an image or canvas onto an offscreen canvas with high-contrast normalization for optimal OCR accuracy.
 */
async function preprocessImageForOCR(source: File | Blob | HTMLCanvasElement | string): Promise<HTMLCanvasElement | File | Blob | string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return source;
  }

  try {
    if (source instanceof HTMLCanvasElement) {
      return source;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    const objectUrl =
      typeof source === 'string'
        ? source
        : URL.createObjectURL(source);

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = objectUrl;
    });

    if (typeof source !== 'string') {
      URL.revokeObjectURL(objectUrl);
    }

    const maxDim = 2000;
    const minDim = 900;
    let width = img.naturalWidth || img.width || 800;
    let height = img.naturalHeight || img.height || 600;

    if (Math.max(width, height) < minDim) {
      const scale = minDim / Math.max(width, height, 1);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    } else if (Math.max(width, height) > maxDim) {
      const scale = maxDim / Math.max(width, height, 1);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    // Apply gentle grayscale + contrast boost to sharpen text on colored/notebook backgrounds
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Contrast stretch around midpoint 165
      const stretched = lum < 160 ? Math.max(0, (lum - 40) * 0.9) : Math.min(255, lum + 35);
      data[i] = stretched;
      data[i + 1] = stretched;
      data[i + 2] = stretched;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  } catch {
    return source;
  }
}

/**
 * Runs local optical character recognition (OCR) on an image or rendered PDF page using Tesseract.js.
 * Works completely offline/client-side in "Modo Estudio Sin IA".
 */
export async function extractImageTextWithOCR(
  source: File | Blob | HTMLCanvasElement | string
): Promise<string> {
  if (typeof window === 'undefined') return '';

  try {
    const prepared = await preprocessImageForOCR(source);
    const TesseractModule = await import('tesseract.js');
    const recognizeFn = TesseractModule.recognize || TesseractModule.default?.recognize;
    if (!recognizeFn) return '';

    const ocrPromise = recognizeFn(prepared, 'spa+eng');
    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 18000));

    const result = await Promise.race([ocrPromise, timeoutPromise]);
    if (result && result.data && typeof result.data.text === 'string') {
      const cleaned = sanitizeAcademicText(result.data.text);
      if (cleaned.length >= 15 && !isBinaryGarbage(cleaned)) {
        return cleaned;
      }
    }
  } catch (err) {
    console.warn('Local OCR warning:', err);
  }
  return '';
}

/**
 * Primary PDF text extractor using Mozilla's `pdfjs-dist` engine.
 * Accurately decodes per-font ToUnicode CMaps, CID fonts, kerning arrays, and spatial text layout.
 * If the PDF is a scanned document (image-only pages), automatically renders pages to canvas and runs OCR!
 */
async function extractPdfWithPdfJs(buffer: ArrayBuffer): Promise<string> {
  try {
    // Register in-process worker handler so pdfjs-dist works in both Vite browser and Node test runner without external CDN dependency
    // @ts-expect-error - pdf.worker.mjs does not ship a separate .d.mts file
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const dataCopy = new Uint8Array(buffer.slice(0));
    const loadingTask = pdfjs.getDocument({
      data: dataCopy,
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });

    const pdfDoc = await loadingTask.promise;
    const maxPages = Math.min(pdfDoc.numPages, 40);
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      let pageStr = '';
      let lastY: number | null = null;
      let lastEndX: number | null = null;

      for (const rawItem of textContent.items) {
        if (!('str' in rawItem)) continue;
        const str = rawItem.str;
        if (!str) {
          if (rawItem.hasEOL) {
            pageStr += '\n';
            lastY = null;
            lastEndX = null;
          }
          continue;
        }

        const transform = rawItem.transform || [10, 0, 0, 10, 0, 0];
        const fontSize = Math.max(Math.abs(transform[0] || 10), Math.abs(transform[3] || 10), 8);
        const x = transform[4] || 0;
        const y = transform[5] || 0;
        const width = rawItem.width || str.length * (fontSize * 0.5);

        if (lastY !== null) {
          const dy = Math.abs(y - lastY);
          if (dy > fontSize * 1.65) {
            pageStr += '\n\n';
          } else if (dy > fontSize * 0.45) {
            pageStr += '\n';
          } else if (lastEndX !== null) {
            const dx = x - lastEndX;
            if (dx > fontSize * 0.16 && !pageStr.endsWith(' ') && !str.startsWith(' ')) {
              pageStr += ' ';
            }
          }
        }

        pageStr += str;
        if (rawItem.hasEOL) {
          pageStr += '\n';
          lastY = null;
          lastEndX = null;
        } else {
          lastY = y;
          lastEndX = x + width;
        }
      }

      const cleanedPage = sanitizeAcademicText(pageStr);
      if (cleanedPage.trim().length > 0) {
        pageTexts.push(cleanedPage.trim());
      }
    }

    const fullDigitalText = sanitizeAcademicText(pageTexts.join('\n\n'));
    if (fullDigitalText.length >= 30 && !isBinaryGarbage(fullDigitalText)) {
      return fullDigitalText;
    }

    // Scanned PDF fallback: If the PDF had no digital text and we are in the browser, render up to 3 pages to canvas and OCR them!
    if (typeof document !== 'undefined' && pdfDoc.numPages > 0) {
      const ocrPages: string[] = [];
      const pagesToOcr = Math.min(pdfDoc.numPages, 3);
      for (let pageNum = 1; pageNum <= pagesToOcr; pageNum++) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.75 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
            const pageOcrText = await extractImageTextWithOCR(canvas);
            if (pageOcrText.trim()) {
              ocrPages.push(pageOcrText.trim());
            }
          }
        } catch {
          // Ignore single page render failure
        }
      }
      const combinedOcr = sanitizeAcademicText(ocrPages.join('\n\n'));
      if (combinedOcr.length >= 20) {
        return combinedOcr;
      }
    }
  } catch (err) {
    console.warn('pdfjs extraction fallback triggered:', err);
  }
  return '';
}

/**
 * Decodes PDF literal strings (...) handling escapes and octal sequences (used only when fallback stream parser is needed).
 */
function decodePdfLiteralString(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) {
      const next = str[++i];
      if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else if (next === 't') out += '\t';
      else if (next === '(' || next === ')' || next === '\\') out += next;
      else if (next >= '0' && next <= '7') {
        let oct = next;
        if (i + 1 < str.length && str[i + 1] >= '0' && str[i + 1] <= '7') oct += str[++i];
        if (i + 1 < str.length && str[i + 1] >= '0' && str[i + 1] <= '7') oct += str[++i];
        out += String.fromCharCode(parseInt(oct, 8));
      } else {
        out += next;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Fallback stream extractor for minimal synthetic PDFs without xref tables.
 * Uses isolated per-stream CMaps so multi-font CMaps NEVER collide globally.
 */
async function extractPdfTextFallback(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const latin1Decoder = new TextDecoder('latin1');
  const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
  const rawPdf = latin1Decoder.decode(bytes);

  const extractedBlocks: string[] = [];
  let activeCMap = new Map<string, string>();

  let searchPos = 0;
  let streamCount = 0;
  while (searchPos < rawPdf.length && streamCount < 160) {
    const streamIdx = rawPdf.indexOf('stream', searchPos);
    if (streamIdx === -1) break;
    const endStreamIdx = rawPdf.indexOf('endstream', streamIdx + 6);
    if (endStreamIdx === -1) break;

    let startOffset = streamIdx + 6;
    if (rawPdf[startOffset] === '\r' && rawPdf[startOffset + 1] === '\n') startOffset += 2;
    else if (rawPdf[startOffset] === '\n' || rawPdf[startOffset] === '\r') startOffset += 1;

    let endOffset = endStreamIdx;
    if (rawPdf[endOffset - 1] === '\n') endOffset--;
    if (rawPdf[endOffset - 1] === '\r') endOffset--;

    if (endOffset > startOffset && endOffset - startOffset < 3 * 1024 * 1024) {
      const subBytes = bytes.subarray(startOffset, endOffset);
      const decompressed = await decompressPdfStream(subBytes);
      const streamContent = decompressed
        ? latin1Decoder.decode(decompressed)
        : rawPdf.slice(startOffset, endOffset);

      if (streamContent.includes('beginbfchar') || streamContent.includes('beginbfrange')) {
        // Scope CMap to a fresh map so different fonts do not overwrite each other's glyph IDs
        activeCMap = new Map<string, string>();
        const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
        let block: RegExpExecArray | null;
        while ((block = bfcharRegex.exec(streamContent)) !== null) {
          const pairRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
          let pair: RegExpExecArray | null;
          while ((pair = pairRegex.exec(block[1])) !== null) {
            const src = pair[1].toUpperCase();
            const dstHex = pair[2];
            let str = '';
            for (let i = 0; i + 3 < dstHex.length; i += 4) {
              const cp = parseInt(dstHex.slice(i, i + 4), 16);
              if (!isNaN(cp)) str += String.fromCodePoint(cp);
            }
            if (str) activeCMap.set(src, str);
          }
        }
      }

      if (streamContent.includes('Tj') || streamContent.includes('TJ')) {
        const pieces: string[] = [];
        const tjArrayRegex = /\[((?:[^\]]|\n)*?)\]\s*TJ/g;
        let match: RegExpExecArray | null;
        while ((match = tjArrayRegex.exec(streamContent)) !== null) {
          const inner = match[1];
          const tokenRegex = /\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g;
          let tok: RegExpExecArray | null;
          let line = '';
          while ((tok = tokenRegex.exec(inner)) !== null) {
            if (tok[1] !== undefined) {
              line += decodePdfLiteralString(tok[1]);
            } else if (tok[2] !== undefined) {
              const kern = parseFloat(tok[2]);
              if (kern < -120 && !line.endsWith(' ')) line += ' ';
            }
          }
          if (line.trim()) pieces.push(line);
        }

        const singleTjRegex = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;
        while ((match = singleTjRegex.exec(streamContent)) !== null) {
          const decoded = decodePdfLiteralString(match[1]);
          if (decoded.trim()) pieces.push(decoded);
        }

        const text = pieces.join(' ');
        if (text.trim().length > 2) {
          extractedBlocks.push(text.trim());
        }
      }
      streamCount++;
    }

    searchPos = endStreamIdx + 9;
  }

  const combined = sanitizeAcademicText(extractedBlocks.join('\n'));
  if (combined.length >= 20 && !isBinaryGarbage(combined)) {
    return combined;
  }

  const asUtf8 = sanitizeAcademicText(utf8Decoder.decode(bytes));
  if (!isBinaryGarbage(asUtf8) && asUtf8.length >= 20) {
    return asUtf8;
  }

  return '';
}

/**
 * Extracts readable text from a PDF ArrayBuffer using pdfjs-dist first, with fallback stream parsing.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const fromPdfJs = await extractPdfWithPdfJs(buffer);
  if (fromPdfJs && fromPdfJs.trim().length >= 20) {
    return fromPdfJs;
  }
  return extractPdfTextFallback(buffer);
}

/**
 * Extracts text from any uploaded File object in the browser (including PDFs, Word, PowerPoint, and OCR on Images).
 */
export async function extractTextFromFile(file: File): Promise<{
  rawText: string;
  base64Data?: string;
}> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'heic'].includes(ext) || file.type.startsWith('image/');

  let base64Data: string | undefined;
  if (file.size < 15 * 1024 * 1024) {
    base64Data = await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
    });
  }

  if (isImage) {
    // Perform real local OCR so "Modo Estudio Sin IA" detects text inside images and diagrams!
    const ocrText = await extractImageTextWithOCR(file);
    return {
      rawText: ocrText,
      base64Data,
    };
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check if ZIP-based Office document (.docx, .pptx, .odt)
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip || ['docx', 'pptx', 'odt'].includes(ext)) {
    const zipText = await extractZipXmlText(buffer);
    if (zipText && !isBinaryGarbage(zipText)) {
      return { rawText: cleanExtractedText(zipText), base64Data };
    }
  }

  // Check if PDF
  const isPdfHeader =
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
  if (isPdfHeader || ext === 'pdf') {
    const pdfText = await extractPdfText(buffer);
    if (pdfText && !isBinaryGarbage(pdfText)) {
      return { rawText: cleanExtractedText(pdfText), base64Data };
    }
    return { rawText: '', base64Data };
  }

  // Plain text / Markdown / CSV / JSON / HTML / XML
  const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
  let text = utf8Decoder.decode(buffer.slice(0, 200000));
  if (['html', 'htm'].includes(ext)) {
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  }
  const cleaned = cleanExtractedText(text);
  if (!isBinaryGarbage(cleaned)) {
    return { rawText: cleaned, base64Data };
  }

  return { rawText: '', base64Data };
}

/**
 * Builds a rich local heuristic analysis (summary, keyThemes, wordCount) strictly from the document's actual text.
 */
export function buildLocalDocAnalysis(doc: Pick<UploadedDoc, 'name' | 'category' | 'rawText'>): NonNullable<UploadedDoc['analysis']> {
  const cleanText = cleanExtractedText(doc.rawText || '');
  const hasRealText = cleanText.length > 20 && !isBinaryGarbage(cleanText) && !cleanText.startsWith('[Imagen multimodal');

  const words = hasRealText ? cleanText.split(/\s+/).filter(w => !isCorruptedToken(w)) : [];
  const wordCount = words.length;

  const sentences = hasRealText
    ? cleanText
        .split(/(?<=[.!?])\s+|\n+/)
        .map(s => s.trim())
        .filter(s => isCleanStudySentence(s))
    : [];

  const summary =
    sentences.length > 0
      ? sentences.slice(0, 2).join(' ')
      : `Documento "${doc.name}" cargado en la sesión. ${
          doc.category === 'image'
            ? 'Imagen procesada con OCR para detección de texto y conceptos.'
            : 'Listo para generación de preguntas basadas exclusivamente en su contenido.'
        }`;

  const freq = new Map<string, { display: string; count: number }>();
  if (hasRealText) {
    const rawTokens = cleanText.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}/g) || [];
    for (const tok of rawTokens) {
      if (!isValidSpanishStudyWord(tok)) continue;
      const lower = tok.toLowerCase();
      const prev = freq.get(lower);
      if (prev) {
        prev.count += 1;
      } else {
        freq.set(lower, { display: tok, count: 1 });
      }
    }
  }

  const sortedThemes = Array.from(freq.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(item => item.display.charAt(0).toUpperCase() + item.display.slice(1).toLowerCase());

  if (sortedThemes.length === 0) {
    const nameTokens = doc.name
      .replace(/\.[^.]+$/, '')
      .replace(/\(\d+\)/g, '')
      .split(/[_\-\s.]+/)
      .filter(t => isValidSpanishStudyWord(t));
    sortedThemes.push(
      ...nameTokens.slice(0, 4).map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    );
  }

  const hasHandwriting =
    /apunte|mano|cuaderno|pizarra|manuscrito|htr|caligrafia/i.test(doc.name) ||
    (hasRealText && /manuscrito|a mano|al margen|cuaderno/i.test(cleanText));

  return {
    summary,
    keyThemes: sortedThemes.length > 0 ? sortedThemes : ['Conceptos principales'],
    hasHandwriting,
    handwrittenNotes: hasHandwriting && sentences.length > 0 ? [sentences[0]] : [],
    diagramDescriptions: [],
    multimodalNotes: hasRealText
      ? `${doc.category === 'image' ? 'OCR Óptico completado' : 'Texto extraído y depurado'} (${wordCount} palabras válidas).`
      : 'Documento registrado. Si es una imagen sin texto legible, puedes pegar apuntes adicionales haciendo clic en "Editar / Pegar texto".',
    wordCount,
  };
}
