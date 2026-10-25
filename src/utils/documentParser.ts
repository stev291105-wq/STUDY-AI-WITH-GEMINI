import type { UploadedDoc } from '../types.ts';

const SPANISH_STOPWORDS = new Set([
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
  'durante', 'mediante', 'alcanzó', 'alcanzo', 'realiza', 'realizaba', 'caracteriza'
]);

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
  if (!raw) return '';
  return raw
    .replace(/\u0000/g, ' ')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\uFFFD+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Decompresses a Uint8Array using Web Streams DecompressionStream ('deflate' or 'deflate-raw').
 */
async function decompressBytes(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || data.byteLength === 0) return null;
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    writer.write(data).catch(() => {});
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
 * Decodes PDF literal strings (...) handling escapes and octal sequences.
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
 * Parses PDF ToUnicode CMap tables (beginbfchar / beginbfrange) into a glyph->unicode map.
 */
function parseToUnicodeCMap(streamStr: string, cmap: Map<string, string>): void {
  // Parse beginbfchar ... endbfchar
  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let block: RegExpExecArray | null;
  while ((block = bfcharRegex.exec(streamStr)) !== null) {
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
      if (str) cmap.set(src, str);
    }
  }

  // Parse beginbfrange ... endbfrange
  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = bfrangeRegex.exec(streamStr)) !== null) {
    const rangeRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let rng: RegExpExecArray | null;
    while ((rng = rangeRegex.exec(block[1])) !== null) {
      const startCode = parseInt(rng[1], 16);
      const endCode = parseInt(rng[2], 16);
      let targetCp = parseInt(rng[3], 16);
      const hexLen = rng[1].length;
      if (!isNaN(startCode) && !isNaN(endCode) && !isNaN(targetCp) && endCode - startCode < 512) {
        for (let c = startCode; c <= endCode; c++) {
          const key = c.toString(16).toUpperCase().padStart(hexLen, '0');
          cmap.set(key, String.fromCodePoint(targetCp++));
        }
      }
    }
  }
}

/**
 * Decodes PDF hex strings <...> using CMap if available, or UTF-16BE / Latin1 fallback.
 */
function decodePdfHexString(hex: string, cmap: Map<string, string>): string {
  const clean = hex.replace(/\s+/g, '').toUpperCase();
  if (clean.length === 0) return '';

  if (cmap.size > 0) {
    // Check if 4-hex-digit (2-byte CID) or 2-hex-digit keys are in cmap
    const has4Digit = clean.length % 4 === 0 && cmap.has(clean.slice(0, 4));
    const step = has4Digit ? 4 : 2;
    let mappedOut = '';
    let hits = 0;
    for (let i = 0; i + step <= clean.length; i += step) {
      const code = clean.slice(i, i + step);
      const mapped = cmap.get(code);
      if (mapped !== undefined) {
        mappedOut += mapped;
        hits++;
      }
    }
    if (hits > 0) return mappedOut;
  }

  if (clean.startsWith('FEFF')) {
    let out = '';
    for (let i = 4; i + 3 < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (!isNaN(code) && code >= 32) out += String.fromCharCode(code);
    }
    return out;
  }
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (!isNaN(code) && code >= 32) out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Extracts text operators from a decompressed PDF content stream.
 */
function extractTextFromPdfStream(streamStr: string, cmap: Map<string, string>): string {
  const pieces: string[] = [];

  // Match TJ arrays: [ (text) -20 (more) ] TJ
  const tjArrayRegex = /\[((?:[^\]]|\n)*?)\]\s*TJ/g;
  let match: RegExpExecArray | null;
  while ((match = tjArrayRegex.exec(streamStr)) !== null) {
    const inner = match[1];
    const tokenRegex = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g;
    let tok: RegExpExecArray | null;
    let line = '';
    while ((tok = tokenRegex.exec(inner)) !== null) {
      if (tok[1] !== undefined) {
        line += decodePdfLiteralString(tok[1]);
      } else if (tok[2] !== undefined) {
        line += decodePdfHexString(tok[2], cmap);
      }
    }
    if (line.trim()) pieces.push(line);
  }

  // Match single (text) Tj or <hex> Tj
  const singleTjRegex = /(?:\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>)\s*(?:Tj|'|")/g;
  while ((match = singleTjRegex.exec(streamStr)) !== null) {
    const decoded =
      match[1] !== undefined
        ? decodePdfLiteralString(match[1])
        : decodePdfHexString(match[2] || '', cmap);
    if (decoded.trim()) pieces.push(decoded);
  }

  return pieces.join(' ');
}

/**
 * Extracts readable text from a PDF ArrayBuffer by decompressing FlateDecode streams, building CMap tables, and parsing text blocks.
 */
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const latin1Decoder = new TextDecoder('latin1');
  const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
  const rawPdf = latin1Decoder.decode(bytes);

  const decompressedStreams: string[] = [];
  const cmap = new Map<string, string>();

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
        parseToUnicodeCMap(streamContent, cmap);
      }
      if (streamContent.includes('Tj') || streamContent.includes('TJ')) {
        decompressedStreams.push(streamContent);
      }
      streamCount++;
    }

    searchPos = endStreamIdx + 9;
  }

  const extractedBlocks: string[] = [];
  for (const s of decompressedStreams) {
    const text = extractTextFromPdfStream(s, cmap);
    if (text.trim().length > 2) {
      extractedBlocks.push(text.trim());
    }
  }

  const combined = cleanExtractedText(extractedBlocks.join('\n'));
  if (combined.length >= 25 && !isBinaryGarbage(combined)) {
    return combined;
  }

  const asUtf8 = cleanExtractedText(utf8Decoder.decode(bytes));
  if (!isBinaryGarbage(asUtf8) && asUtf8.length >= 20) {
    return asUtf8;
  }

  return '';
}

/**
 * Extracts text from any uploaded File object in the browser.
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
    return {
      rawText: '',
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

  const words = hasRealText ? cleanText.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;

  const sentences = hasRealText
    ? cleanText
        .split(/(?<=[.!?])\s+|\n+/)
        .map(s => s.trim())
        .filter(s => s.length >= 25 && s.length <= 320)
    : [];

  const summary =
    sentences.length > 0
      ? sentences.slice(0, 2).join(' ')
      : `Documento "${doc.name}" cargado en la sesión. ${
          doc.category === 'image'
            ? 'Imagen lista para análisis visual OCR/HTR o transcripción manual.'
            : 'Listo para generación de preguntas basadas en su contenido.'
        }`;

  const freq = new Map<string, { display: string; count: number }>();
  if (hasRealText) {
    const rawTokens = cleanText.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}/g) || [];
    for (const tok of rawTokens) {
      const lower = tok.toLowerCase();
      if (SPANISH_STOPWORDS.has(lower)) continue;
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
    .map(item => item.display.charAt(0).toUpperCase() + item.display.slice(1));

  if (sortedThemes.length === 0) {
    const nameTokens = doc.name
      .replace(/\.[^.]+$/, '')
      .split(/[_\-\s.]+/)
      .filter(t => t.length >= 3 && !SPANISH_STOPWORDS.has(t.toLowerCase()));
    sortedThemes.push(...nameTokens.slice(0, 4));
  }

  const hasHandwriting =
    /apunte|mano|cuaderno|pizarra|manuscrito|htr|caligrafia/i.test(doc.name) ||
    (hasRealText && /manuscrito|a mano|al margen|cuaderno/i.test(cleanText));

  return {
    summary,
    keyThemes: sortedThemes.length > 0 ? sortedThemes : [doc.name.replace(/\.[^.]+$/, '')],
    hasHandwriting,
    handwrittenNotes: hasHandwriting && sentences.length > 0 ? [sentences[0]] : [],
    diagramDescriptions: [],
    multimodalNotes: hasRealText
      ? `Texto extraído íntegramente del documento (${wordCount} palabras).`
      : 'Documento registrado. Si es un PDF escaneado o imagen en Modo Sin IA, puedes pegar o editar su texto haciendo clic en el documento.',
    wordCount,
  };
}
