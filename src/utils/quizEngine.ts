import type { DifficultyLevel, Question, QuestionModality, QuizConfig, QuizSummary, UploadedDoc, UserAnswer } from '../types.ts';
import {
  cleanExtractedText,
  isBinaryGarbage,
  isValidSpanishStudyWord,
  isCleanStudySentence,
  isCorruptedToken,
  SPANISH_STOPWORDS,
} from './documentParser.ts';

const STOPWORDS = SPANISH_STOPWORDS;

/**
 * Validates and updates modality selection enforcing the max 3 modes rule.
 */
export function toggleModalitySelection(
  current: QuestionModality[],
  target: QuestionModality
): { updated: QuestionModality[]; canAddMore: boolean; isBlocked: boolean } {
  const exists = current.includes(target);

  if (exists) {
    if (current.length === 1) {
      return { updated: current, canAddMore: true, isBlocked: false };
    }
    const updated = current.filter(m => m !== target);
    return { updated, canAddMore: updated.length < 3, isBlocked: false };
  } else {
    if (current.length >= 3) {
      return { updated: current, canAddMore: false, isBlocked: true };
    }
    const updated = [...current, target];
    return { updated, canAddMore: updated.length < 3, isBlocked: false };
  }
}

/**
 * Normalizes string for fair comparison (strips accents, lowercases, trims, removes punctuation).
 */
export function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?¿¡!«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mechanica A: Single Choice & True/False instant evaluation
 */
export function evaluateMechanicA(question: Question, selectedOption: string): { isCorrect: boolean } {
  const normUser = normalizeText(selectedOption);
  const normCorrect = normalizeText(question.correctAnswer);
  const isCorrect = normUser === normCorrect;
  return { isCorrect };
}

/**
 * Mechanica B: Helper for text similarity assessment between user response and official answer.
 * Calculates Jaccard token overlap to assist the student before self-evaluation.
 */
export function assessSemanticSimilarity(userInput: string, officialAnswer: string): {
  similarityScore: number; // 0 to 1
  suggestedMatch: boolean;
  highlightedKeywords: string[];
} {
  const userTokens = new Set(normalizeText(userInput).split(' ').filter(t => t.length > 2));
  const officialTokens = new Set(normalizeText(officialAnswer).split(' ').filter(t => t.length > 2));

  if (officialTokens.size === 0 || userTokens.size === 0) {
    return { similarityScore: 0, suggestedMatch: false, highlightedKeywords: [] };
  }

  const matches: string[] = [];
  userTokens.forEach(token => {
    if (officialTokens.has(token)) {
      matches.push(token);
    }
  });

  const overlap = matches.length;
  const similarityScore = Math.min(1, overlap / Math.max(1, Math.min(officialTokens.size, 6)));
  const suggestedMatch = similarityScore >= 0.5 || normalizeText(userInput) === normalizeText(officialAnswer);

  return {
    similarityScore: Math.round(similarityScore * 100) / 100,
    suggestedMatch,
    highlightedKeywords: matches,
  };
}

/**
 * Calculates global quiz stats, category breakdown and Jacqueline badge.
 */
export function calculateQuizSummary(
  questions: Question[],
  answers: Record<string, UserAnswer>,
  difficulty: DifficultyLevel,
  timeSpentSeconds: number
): QuizSummary {
  let correctCount = 0;
  const total = questions.length;

  const modalityBreakdown: Record<QuestionModality, { total: number; correct: number }> = {
    multiple_choice: { total: 0, correct: 0 },
    true_false: { total: 0, correct: 0 },
    fill_blank: { total: 0, correct: 0 },
    open_question: { total: 0, correct: 0 },
  };

  const questionsReview = questions.map(q => {
    const ans = answers[q.id];
    const isCorrect = ans ? Boolean(ans.isCorrect) : false;

    if (modalityBreakdown[q.type]) {
      modalityBreakdown[q.type].total += 1;
      if (isCorrect) {
        modalityBreakdown[q.type].correct += 1;
      }
    }

    if (isCorrect) {
      correctCount += 1;
    }

    return {
      question: q,
      userAnswer: ans,
    };
  });

  const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const isJacquelineMaster = difficulty === 'jacqueline' && percentage >= 80;

  return {
    totalQuestions: total,
    correctAnswers: correctCount,
    incorrectAnswers: total - correctCount,
    scorePercentage: percentage,
    timeSpentSeconds,
    difficulty,
    isJacquelineMaster,
    modalityBreakdown,
    questionsReview,
  };
}

/**
 * Built-in seed documents with OCR, handwriting and diagram contexts (only loaded when explicitly requested)
 */
export const PRESET_SAMPLE_DOCUMENTS: UploadedDoc[] = [
  {
    id: 'sample-doc-1',
    name: 'Apuntes_Manuscritos_Biologia_Celular.jpg',
    size: 2450000,
    type: 'image/jpeg',
    extension: '.jpg',
    category: 'image',
    rawText: `[OCR HTR - Texto Manuscrito detectado en cuaderno de apuntes]:
Tema: Respiración Celular y Fosforilación Oxidativa.
Notas al margen a mano del profesor: "Ojo para el examen: El gradiente electroquímico de protones se genera a través de la membrana mitocondrial interna gracias a los complejos I, III y IV de la cadena transportadora de electrones. El complejo II (succinato deshidrogenasa) no bombea protones directamente.
Ecuación estequiométrica neta: C6H12O6 + 6O2 -> 6CO2 + 6H2O + ~30-32 ATP.
Flecha dibujada a mano: 'ATP Sintasa (Complejo V) funciona como una turbina molecular giratoria impulsada por fuerza protón-motriz'.
Fórmula escrita a mano: Δp = ΔΨ - (2.3 RT/F) ΔpH."`,
    status: 'ready',
    analysis: {
      summary: 'Apuntes de cuaderno con caligrafía manual sobre bioenergética y fosforilación oxidativa mitocondrial.',
      keyThemes: ['Cadena de transporte de electrones', 'Fuerza protón-motriz', 'ATP Sintasa', 'Complejo II'],
      hasHandwriting: true,
      handwrittenNotes: [
        'El Complejo II no bombea protones al espacio intermembrana.',
        'La ATP Sintasa opera como motor rotatorio catalizado por subunidades gamma y c.',
        'Δp depende del potencial eléctrico y del gradiente químico de pH.'
      ],
      diagramDescriptions: ['Esquema dibujado a mano de cresta mitocondrial con flujo de e- de NADH a O2.'],
      multimodalNotes: 'Reconocimiento HTR completado con 98% de confianza en caligrafía cursiva.',
      wordCount: 165
    }
  },
  {
    id: 'sample-doc-2',
    name: 'Guia_Derecho_Constitucional_y_DDHH.pdf',
    size: 1820000,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: `Capítulo 4: El Bloque de Constitucionalidad y Control de Convencionalidad.
El control de convencionalidad es el mecanismo jurisprudencial mediante el cual los jueces y tribunales nacionales deben verificar la conformidad de las normas internas con el Pacto de San José de Costa Rica (CADH) y la jurisprudencia de la Corte Interamericana de Derechos Humanos (Corte IDH).
Sentencia hito: Caso Almonacid Arellano vs. Chile (2006), donde se determinó que el Poder Judicial debe ejercer un control de convencionalidad ex officio entre las normas internas y la Convención Americana.
Principio Pro Persona (o Pro Homine): Criterio hermenéutico que impone la aplicación de la norma o interpretación más favorable a la persona humana. Se consagra en el artículo 29 de la CADH.
Diferencia clave: El control difuso de constitucionalidad puede ser inaplicativo inter partes, mientras que el control concentrado suele expulsar la norma del ordenamiento con efectos erga omnes.`,
    status: 'ready',
    analysis: {
      summary: 'Tratado de control de convencionalidad, principio pro homine y jerarquía de tratados de DDHH.',
      keyThemes: ['Control de convencionalidad ex officio', 'Caso Almonacid Arellano', 'Principio Pro Persona', 'CADH'],
      hasHandwriting: false,
      diagramDescriptions: ['Pirámide kelseniana modificada con bloque de convencionalidad supra-constitucional.'],
      multimodalNotes: 'PDF digital nativo con tablas jurisprudenciales procesadas.',
      wordCount: 220
    }
  },
  {
    id: 'sample-doc-3',
    name: 'Presentacion_Arquitecturas_LLM_Transformers.pptx',
    size: 3400000,
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: '.pptx',
    category: 'powerpoint',
    rawText: `Diapositiva 12: Mecanismo de Multi-Head Scaled Dot-Product Attention.
Fórmula en esquema vectorial: Attention(Q, K, V) = softmax( (Q K^T) / sqrt(d_k) ) * V.
¿Por qué se escala por sqrt(d_k)? Para evitar que para valores grandes de d_k los productos punto crezcan excesivamente en magnitud, empujando la función softmax hacia regiones con gradientes extremadamente pequeños (vanishing gradients).
Positional Encoding: A diferencia de las RNNs recurrentes, el Transformer procesa secuencias en paralelo sin recurrencia temporal, por lo que requiere codificar la posición relativa/absoluta de los tokens mediante funciones senoidales o embeddings rotatorios (RoPE).
Diapositiva 15: Comparativa Encoder-Only (BERT), Decoder-Only (GPT, Gemini, Llama) y Encoder-Decoder (T5). Los modelos autorregresivos modernos emplean arquitecturas Decoder-Only con causal masking.`,
    status: 'ready',
    analysis: {
      summary: 'Explicación técnica del mecanismo de autoatención, positional encodings y arquitecturas decoder-only.',
      keyThemes: ['Scaled Dot-Product Attention', 'Escalamiento sqrt(d_k)', 'Vanishing Gradients', 'Rotary Position Embeddings'],
      hasHandwriting: false,
      diagramDescriptions: ['Diagrama de bloques de atención multicabezal con proyecciones lineales Q, K, V.'],
      multimodalNotes: 'Extracción de diapositivas PPTX con fórmulas LaTeX y matrices de atención.',
      wordCount: 195
    }
  },
  {
    id: 'sample-doc-4',
    name: 'Infografia_Canva_Ciclo_Calvin_Fotosintesis.png',
    size: 1540000,
    type: 'image/png',
    extension: '.png',
    category: 'canva',
    rawText: `[OCR Vision - Esquema Canva de Infografía Científica]:
Título: El Ciclo de Calvin-Benson en el Estroma del Cloroplasto.
Fase 1: Fijación del Carbono catalizada por la enzima RuBisCO (Ribulosa-1,5-bisfosfato carboxilasa-oxigenasa). RuBisCO fija CO2 sobre RuBP formando 3-fosfoglicerato (3-PGA).
Fase 2: Reducción. Se consume ATP y NADPH generados en la fase lumínica para convertir 3-PGA en gliceraldehído-3-fosfato (G3P).
Fase 3: Regeneración de RuBP. Por cada 6 moléculas de G3P producidas, solo 1 sale neta para síntesis de glucosa; 5 se reciclan para regenerar RuBP consumiendo ATP.
Nota en globo Canva: 'La actividad oxigenasa de RuBisCO desencadena fotorrespiración (Ciclo C2), reduciendo la eficiencia fotosintética hasta un 25% en plantas C3 bajo estrés térmico'.`,
    status: 'ready',
    analysis: {
      summary: 'Infografía gráfica de Canva analizada con OCR multimodal sobre las tres fases del ciclo de Calvin y fotorrespiración.',
      keyThemes: ['Enzima RuBisCO', 'Fijación de CO2', 'G3P neto vs reciclado', 'Fotorrespiración en plantas C3'],
      hasHandwriting: false,
      diagramDescriptions: ['Ciclo circular estromático con consumo estequiométrico de 9 ATP y 6 NADPH por cada G3P neto.'],
      multimodalNotes: 'Procesamiento de infografía Canva exportada: tipografía sans-serif vectorial y flechas de ciclo identificadas.',
      wordCount: 180
    }
  }
];

interface ExtractedSentence {
  docName: string;
  text: string;
  keywords: string[];
  conceptPhrase: string;
  topicTitle: string;
  sectionLabel: string;
}

/**
 * Derives a clean, human-readable thematic base title from a document's filename and key themes.
 */
export function deriveDocumentBaseTopic(docName: string, keyThemes?: string[]): string {
  const cleanedName = cleanExtractedText(
    docName
      .replace(/\.[^.]+$/, '')
      .replace(/\(\d+\)/g, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\b(?:resumen|para|el|la|los|las|oral|apuntes|guia|presentacion|infografia|canva|documento|archivo|final|copia)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const validNameWords = cleanedName
    .split(/\s+/)
    .filter(w => w.length >= 2 && !isCorruptedToken(w));

  if (validNameWords.length >= 1) {
    const formatted = validNameWords
      .map((w, idx) => {
        const lower = w.toLowerCase();
        if (idx > 0 && ['y', 'e', 'de', 'del', 'en', 'con', 'sobre'].includes(lower)) {
          return lower;
        }
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
    if (formatted.length >= 4) {
      return formatted;
    }
  }

  const validThemes = (keyThemes || []).filter(t => t && !isCorruptedToken(t.replace(/\s+/g, '')));
  if (validThemes.length > 0) {
    return validThemes.slice(0, 2).join(' y ');
  }

  return 'Conceptos Fundamentales del Documento';
}

/**
 * Detects whether a short line in the document represents a section or thematic heading.
 */
function extractHeadingTopic(line: string): string | null {
  const trimmed = line
    .replace(/^[\s•\-*#R:;«»]+/, '')
    .replace(/\[OCR[^\]]*\]:?/gi, '')
    .trim();
  if (trimmed.length < 5 || trimmed.length > 90) return null;

  // Explicit heading prefixes: "Tema:", "Capítulo 4:", "Fase 1:", "Diapositiva 12:", "1.", "I."
  const explicitMatch = /^(?:tema|cap[íi]tulo|unidad|secci[óo]n|m[óo]dulo|fase|diapositiva|t[íi]tulo|apartado)\s*\d*\s*[:.\-–]\s*(.+)$/i.exec(
    trimmed
  );
  if (explicitMatch && explicitMatch[1]) {
    const headingBody = explicitMatch[1].replace(/[.]+$/, '').trim();
    if (headingBody.length >= 4 && !isCorruptedToken(headingBody.split(/\s+/)[0])) {
      return headingBody;
    }
  }

  // Numbered heading e.g. "1. Entrevista Clínica" or "2.1 Evaluación Psicodiagnóstica"
  const numberedMatch = /^\d+(?:\.\d+)?\s*[.)\-–]\s*([A-ZÁÉÍÓÚÜÑ][^.!?]{4,75})$/.exec(trimmed);
  if (numberedMatch && numberedMatch[1]) {
    const words = numberedMatch[1].trim().split(/\s+/);
    if (words.every(w => !isCorruptedToken(w))) {
      return numberedMatch[1].trim();
    }
  }

  // Short title line without period at the end and without finite verbs
  if (!/[.!?]$/.test(trimmed)) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    const validCount = words.filter(w => isValidSpanishStudyWord(w)).length;
    const hasFiniteVerb = /\b(?:es|son|está|están|inicia|constituye|permite|establece|consiste|evalúa|comprende|impone|debe|puede)\b/i.test(
      trimmed
    );
    if (
      !hasFiniteVerb &&
      words.length >= 2 &&
      words.length <= 8 &&
      validCount >= 1 &&
      words.every(w => !isCorruptedToken(w))
    ) {
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
  }

  return null;
}

/**
 * Extracts a meaningful multi-word nominal concept phrase from a sentence (e.g. "entrevista semidirigida",
 * "proceso psicodiagnóstico clínico", "control de convencionalidad", "arquitectura incaica").
 */
function extractConceptPhrase(sentence: string, fallbackKeyword: string): string {
  // 1. Check if sentence starts with "Concepto: explicación"
  const colonIdx = sentence.indexOf(':');
  if (colonIdx >= 4 && colonIdx <= 48) {
    const leftSide = sentence
      .slice(0, colonIdx)
      .replace(/^(?:tema|cap[íi]tulo|fase|diapositiva|nota|diferencia clave|sentencia hito)\s*\d*\s*/i, '')
      .trim();
    if (leftSide.length >= 4 && leftSide.split(/\s+/).length <= 6 && !isCorruptedToken(leftSide.split(/\s+/)[0])) {
      return leftSide;
    }
  }

  // 2. Check subject noun phrase before a defining verb ("El proceso psicodiagnóstico clínico se inicia...", "La arquitectura incaica destaca...")
  const subjectMatch = /^(?:El|La|Los|Las|Un|Una)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+(?:de|del|en|para|por|la|el|los|las)?\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,4}?)\s+(?:es|son|se\s+inicia|constituye|consiste|permite|destaca|alcanz[óo]|fue|fueron|se\s+registra|se\s+genera|funciona|opera|impone|establece|representa|comprende|requiere|incluye|eval[úu]a)/i.exec(
    sentence.trim()
  );
  if (subjectMatch && subjectMatch[1]) {
    const candidate = subjectMatch[1].trim();
    const words = candidate.split(/\s+/);
    if (words.length >= 1 && words.length <= 6 && words.some(w => isValidSpanishStudyWord(w))) {
      return candidate;
    }
  }

  // 3. Look for a 2-3 word technical noun phrase around `fallbackKeyword`
  if (fallbackKeyword && fallbackKeyword.length >= 4) {
    const escaped = fallbackKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const npRegex = new RegExp(
      `\\b(${escaped}\\s+(?:de\\s+|del\\s+)?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}|[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}\\s+${escaped})\\b`,
      'i'
    );
    const m = npRegex.exec(sentence);
    if (m && m[1]) {
      const phraseWords = m[1].trim().split(/\s+/);
      if (phraseWords.every(w => !isCorruptedToken(w)) && phraseWords.filter(w => isValidSpanishStudyWord(w)).length >= 2) {
        return m[1].trim();
      }
    }
  }

  return fallbackKeyword;
}

/**
 * Builds a specific thematic title (`topicTitle`) for a sentence using any detected section heading,
 * the document's base topic, and the primary domain concepts in that sentence.
 */
function buildSentenceTopicTitle(
  baseDocTopic: string,
  activeHeading: string | null,
  conceptPhrase: string,
  sentenceKeywords: string[]
): string {
  if (activeHeading && activeHeading.length >= 4) {
    return activeHeading;
  }

  const formattedConcept =
    conceptPhrase && conceptPhrase.length >= 4
      ? conceptPhrase.charAt(0).toUpperCase() + conceptPhrase.slice(1)
      : '';

  if (formattedConcept && !normalizeText(baseDocTopic).includes(normalizeText(formattedConcept))) {
    return `${baseDocTopic} • ${formattedConcept}`;
  }

  const cleanKw = sentenceKeywords
    .filter(k => isValidSpanishStudyWord(k))
    .map(k => k.charAt(0).toUpperCase() + k.slice(1).toLowerCase());

  if (cleanKw.length >= 2) {
    const kwPair = `${cleanKw[0]} y ${cleanKw[1]}`;
    if (normalizeText(baseDocTopic).includes(normalizeText(cleanKw[0]))) {
      return `${baseDocTopic}: ${cleanKw[1]}`;
    }
    return `${baseDocTopic} • ${kwPair}`;
  }
  if (cleanKw.length === 1) {
    if (normalizeText(baseDocTopic).includes(normalizeText(cleanKw[0]))) {
      return baseDocTopic;
    }
    return `${baseDocTopic} • ${cleanKw[0]}`;
  }
  return baseDocTopic;
}

/**
 * Splits a paragraph into individual complete sentences without breaking on abbreviations like "vs.", "art.", "ej.", "dr.", "cap.", "etc.".
 */
function splitParagraphIntoCompleteSentences(paragraph: string): string[] {
  const protectedText = paragraph
    .replace(/\b(vs|art|arts|ej|dr|dra|sr|sra|cap|pág|pag|fig|inc|núm|num|etc|aprox|prof)\./gi, '$1__DOT__');

  const rawSentences = protectedText
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡"«(0-9])/)
    .map(s => s.replace(/__DOT__/g, '.').trim())
    .filter(Boolean);

  return rawSentences;
}

/**
 * Extracts meaningful sentences, thematic titles, nominal concept phrases, and keywords strictly from the uploaded documents.
 */
function extractDocumentKnowledge(docs: UploadedDoc[]): {
  sentences: ExtractedSentence[];
  allKeywords: string[];
  allConceptPhrases: string[];
} {
  const sentences: ExtractedSentence[] = [];
  const keywordCounts = new Map<string, { original: string; count: number }>();
  const conceptPhrasesSet = new Set<string>();

  for (const doc of docs) {
    const baseDocTopic = deriveDocumentBaseTopic(doc.name, doc.analysis?.keyThemes);
    const parts: string[] = [];

    if (doc.rawText && !isBinaryGarbage(doc.rawText) && !doc.rawText.startsWith('[Imagen multimodal')) {
      parts.push(cleanExtractedText(doc.rawText));
    }
    if (
      doc.analysis?.summary &&
      !doc.analysis.summary.includes('indexado localmente') &&
      !doc.analysis.summary.startsWith('Documento "')
    ) {
      parts.push(cleanExtractedText(doc.analysis.summary));
    }
    if (doc.analysis?.handwrittenNotes?.length) {
      parts.push(...doc.analysis.handwrittenNotes.map(n => cleanExtractedText(n)));
    }
    if (doc.analysis?.diagramDescriptions?.length) {
      parts.push(...doc.analysis.diagramDescriptions.map(d => cleanExtractedText(d)));
    }

    const fullText = parts.join('\n');
    const lines = fullText.split(/\n+/);
    let currentHeading: string | null = null;

    for (const rawLine of lines) {
      const trimmedLine = rawLine.trim();
      if (!trimmedLine) continue;

      const possibleHeading = extractHeadingTopic(trimmedLine);
      if (possibleHeading && trimmedLine.length < 85 && !/[.!?].+[.!?]/.test(trimmedLine)) {
        currentHeading = possibleHeading;
        if (trimmedLine.length < 65 || !/[.!?]$/.test(trimmedLine)) {
          continue;
        }
      }

      const rawChunks = splitParagraphIntoCompleteSentences(
        trimmedLine.replace(/^\d+(?:\.\d+)?\s*[.)\-–]\s*/, '')
      )
        .map(s =>
          s
            .replace(/^[\s•\-*R:;«»]+/, '')
            .replace(/\[OCR[^\]]*\]:?/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter(s => isCleanStudySentence(s) && s.length >= 35 && s.split(/\s+/).length >= 6);

      for (const chunk of rawChunks) {
        const colonPrefix = chunk.includes(':') ? chunk.split(':')[0] || '' : '';
        const inlineHeading = colonPrefix.length <= 50 ? extractHeadingTopic(colonPrefix) : null;
        const effectiveHeading = inlineHeading || currentHeading;

        const matches = chunk.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}/g) || [];
        const chunkKeywords: string[] = [];
        const seenInChunk = new Set<string>();

        for (const word of matches) {
          if (!isValidSpanishStudyWord(word)) continue;
          const lower = word.toLowerCase();
          if (!seenInChunk.has(lower)) {
            seenInChunk.add(lower);
            chunkKeywords.push(word);
          }
          const existing = keywordCounts.get(lower);
          if (existing) {
            existing.count += 1;
          } else {
            keywordCounts.set(lower, { original: word, count: 1 });
          }
        }

        // Prefer substantive academic terms first
        chunkKeywords.sort((a, b) => b.length - a.length);

        if (chunkKeywords.length >= 1) {
          const cleanSentenceText =
            chunk.endsWith('.') || chunk.endsWith('?') || chunk.endsWith('!') ? chunk : `${chunk}.`;
          if (!sentences.some(existing => normalizeText(existing.text) === normalizeText(cleanSentenceText))) {
            const conceptPhrase = extractConceptPhrase(cleanSentenceText, chunkKeywords[0]);
            if (conceptPhrase && conceptPhrase.length >= 4) {
              conceptPhrasesSet.add(conceptPhrase);
            }
            const topicTitle = buildSentenceTopicTitle(
              baseDocTopic,
              effectiveHeading,
              conceptPhrase,
              chunkKeywords
            );
            sentences.push({
              docName: doc.name,
              text: cleanSentenceText,
              keywords: chunkKeywords,
              conceptPhrase,
              topicTitle,
              sectionLabel: topicTitle,
            });
          }
        }
      }
    }

    // Also include valid keyThemes if provided
    if (doc.analysis?.keyThemes) {
      for (const theme of doc.analysis.keyThemes) {
        const cleanTheme = cleanExtractedText(theme).trim();
        const themeWords = cleanTheme.split(/\s+/).filter(w => !isCorruptedToken(w));
        if (
          cleanTheme.length >= 4 &&
          themeWords.length > 0 &&
          !STOPWORDS.has(cleanTheme.toLowerCase()) &&
          !isCorruptedToken(cleanTheme.replace(/\s+/g, ''))
        ) {
          conceptPhrasesSet.add(cleanTheme);
          const lower = cleanTheme.toLowerCase();
          if (!keywordCounts.has(lower)) {
            keywordCounts.set(lower, { original: cleanTheme, count: 2 });
          }
        }
      }
    }

    // If a document had very little clean text (e.g. a title-only cover or short image without OCR prose),
    // synthesize clean, complete academic statements from its sanitized words and filename concepts.
    if (sentences.filter(s => s.docName === doc.name).length === 0) {
      const sanitizedRaw = cleanExtractedText(doc.rawText || '');
      const rawValidWords = (sanitizedRaw.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}/g) || []).filter(w =>
        isValidSpanishStudyWord(w)
      );
      const baseWords = baseDocTopic
        .split(/\s+/)
        .filter(w => isValidSpanishStudyWord(w));

      const combinedValid = Array.from(
        new Set([...rawValidWords, ...baseWords].map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      );
      const kws = combinedValid.length > 0 ? combinedValid : ['Evaluación', 'Diagnóstico', 'Metodología'];

      for (const kw of kws) {
        const lower = kw.toLowerCase();
        if (!keywordCounts.has(lower)) {
          keywordCounts.set(lower, { original: kw, count: 2 });
        }
      }

      const primaryTopic = kws[0] || baseDocTopic;
      const secondaryTopic = kws[1] || kws[0] || 'Análisis Clínico';

      sentences.push({
        docName: doc.name,
        text: `El eje conceptual desarrollado en el documento aborda el estudio sistemático de ${primaryTopic} y su articulación metodológica con ${secondaryTopic}.`,
        keywords: [primaryTopic, secondaryTopic],
        conceptPhrase: `${primaryTopic} y ${secondaryTopic}`,
        topicTitle: `${baseDocTopic} • Fundamentos de ${primaryTopic}`,
        sectionLabel: `${baseDocTopic} • Fundamentos de ${primaryTopic}`,
      });

      if (kws.length >= 2) {
        sentences.push({
          docName: doc.name,
          text: `Dentro del marco teórico de ${primaryTopic}, la aplicación rigurosa de ${secondaryTopic} permite fundamentar la evaluación e interpretación integral del material.`,
          keywords: [secondaryTopic, primaryTopic],
          conceptPhrase: secondaryTopic,
          topicTitle: `${baseDocTopic} • Articulación con ${secondaryTopic}`,
          sectionLabel: `${baseDocTopic} • Articulación con ${secondaryTopic}`,
        });
      }
    }
  }

  const allKeywords = Array.from(keywordCounts.values())
    .filter(k => !isCorruptedToken(k.original) && isValidSpanishStudyWord(k.original))
    .sort((a, b) => b.count - a.count || b.original.length - a.original.length)
    .map(k => k.original);

  const allConceptPhrases = Array.from(conceptPhrasesSet);

  return { sentences, allKeywords, allConceptPhrases };
}

/**
 * Deterministically rotates options so the correct answer isn't always in position A.
 */
function rotateOptions(options: string[], seed: number): string[] {
  if (options.length <= 1) return options;
  const copy = [...options];
  const offset = seed % copy.length;
  return [...copy.slice(offset), ...copy.slice(0, offset)];
}

/**
 * Formats an option string so its initial casing matches the target answer cleanly.
 */
function matchOptionCase(candidate: string, referenceTarget: string): string {
  const trimmed = candidate.trim();
  if (!trimmed || !referenceTarget) return trimmed;
  const refStartsUpper = /^[A-ZÁÉÍÓÚÜÑ]/.test(referenceTarget);
  const isAllCaps = referenceTarget.length > 1 && referenceTarget === referenceTarget.toUpperCase();
  if (isAllCaps) return trimmed;
  if (refStartsUpper) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * Replaces the first case-insensitive whole-word occurrence of targetWord in sentence.
 */
function splitSentenceAroundKeyword(
  sentence: string,
  targetWord: string
): { sentenceBefore: string; targetWord: string; sentenceAfter: string } {
  const escaped = targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'i');
  const match = regex.exec(sentence);
  if (!match || match.index === undefined) {
    const words = sentence.split(' ').filter(w => !isCorruptedToken(w));
    const mid = Math.floor(words.length / 2);
    return {
      sentenceBefore: words.slice(0, mid).join(' '),
      targetWord: words[mid] || targetWord,
      sentenceAfter: words.slice(mid + 1).join(' '),
    };
  }
  const idx = match.index;
  const matchedActual = match[1];
  return {
    sentenceBefore: sentence.slice(0, idx).trim(),
    targetWord: matchedActual,
    sentenceAfter: sentence.slice(idx + matchedActual.length).trim(),
  };
}

/**
 * Builds a plausible, grammatically natural false statement from a true document sentence
 * by negating its core finite verb or inverting its main relationship cleanly.
 */
function buildNaturalFalseStatement(
  sObj: ExtractedSentence,
  split: { sentenceBefore: string; targetWord: string; sentenceAfter: string },
  replacementKeyword: string | undefined,
  difficulty: DifficultyLevel
): string {
  // 1. Try natural Spanish verb negation first (produces 100% grammatical sentences without awkward word-splicing)
  const verbNegations: Array<[RegExp, string]> = [
    [/\bse inicia con\b/i, 'prescinde por completo de'],
    [/\bconstituye una\b/i, 'no constituye en ningún caso una'],
    [/\bconstituye un\b/i, 'no constituye en ningún caso un'],
    [/\bpermite establecer\b/i, 'impide establecer'],
    [/\bpermite\b/i, 'impide y descarta'],
    [/\bconsiste en\b/i, 'excluye expresamente'],
    [/\balcanz[óo] su m[áa]xima\b/i, 'perdió toda posibilidad de'],
    [/\bdestaca por el uso de\b/i, 'prohíbe el empleo de'],
    [/\bfue edificada\b/i, 'nunca fue edificada'],
    [/\bse registraba mediante\b/i, 'carecía de registro mediante'],
    [/\beval[úu]a\b/i, 'omite evaluar'],
    [/\bdebe ejercer\b/i, 'tiene prohibido ejercer'],
    [/\bdeben verificar\b/i, 'están exentos de verificar'],
    [/\bimpone la aplicaci[óo]n\b/i, 'rechaza la aplicación'],
    [/\brequiere codificar\b/i, 'prescinde de codificar'],
    [/\bse genera a trav[ée]s de\b/i, 'se bloquea e inhibe en'],
    [/\bfunciona como\b/i, 'Es incapaz de operar como'],
    [/\bfija\b/i, 'es incapaz de fijar'],
    [/\bse consume\b/i, 'no se consume ningún'],
    [/\bse reciclan\b/i, 'jamás se reciclan'],
    [/\bes el\b/i, 'no representa el'],
    [/\bes la\b/i, 'no representa la'],
    [/\bes un\b/i, 'no constituye un'],
    [/\bes una\b/i, 'no constituye una'],
    [/\bson\b/i, 'no son'],
  ];

  for (const [pattern, replacement] of verbNegations) {
    if (pattern.test(sObj.text)) {
      const negated = sObj.text.replace(pattern, replacement);
      if (negated !== sObj.text) {
        return negated.charAt(0).toUpperCase() + negated.slice(1);
      }
    }
  }

  // 2. If replacement keyword is available and fits cleanly
  if (replacementKeyword && split.sentenceBefore && split.sentenceAfter) {
    const formattedReplacement = matchOptionCase(replacementKeyword, split.targetWord);
    if (difficulty === 'jacqueline' || difficulty === 'dificil') {
      return `Contrario a lo expuesto sobre ${sObj.conceptPhrase}, el documento sostiene que el proceso descarta «${split.targetWord}» y depende exclusivamente de «${formattedReplacement}».`;
    }
    return `${split.sentenceBefore} ${formattedReplacement} (en lugar de ${split.targetWord}) ${split.sentenceAfter}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  return `El documento descarta que ${sObj.text.charAt(0).toLowerCase() + sObj.text.slice(1)}`;
}

/**
 * Builds 3 complete, grammatically natural, plausible false statement distractors for a `multiple_choice` question
 * grounded in the concepts and terminology of the uploaded documents.
 */
function buildMultipleChoicePropositionDistractors(
  sObj: ExtractedSentence,
  split: { sentenceBefore: string; targetWord: string; sentenceAfter: string },
  allSentences: ExtractedSentence[],
  allKeywords: string[],
  difficulty: DifficultyLevel,
  seed: number
): string[] {
  const distractors: string[] = [];
  const concept = sObj.conceptPhrase || split.targetWord;
  const otherKeywords = allKeywords.filter(
    k =>
      !isCorruptedToken(k) &&
      normalizeText(k) !== normalizeText(split.targetWord) &&
      !normalizeText(concept).includes(normalizeText(k))
  );

  const kwA = otherKeywords[seed % Math.max(1, otherKeywords.length)] || 'la metodología secundaria';
  const kwB = otherKeywords[(seed + 1) % Math.max(1, otherKeywords.length)] || 'el criterio auxiliar';
  const kwC = otherKeywords[(seed + 2) % Math.max(1, otherKeywords.length)] || 'la fase preliminar';

  // Distractor 1: Direct grammatical negation / inversion of the target sentence
  const falseFromTarget = buildNaturalFalseStatement(sObj, split, kwA, difficulty);
  if (normalizeText(falseFromTarget) !== normalizeText(sObj.text)) {
    distractors.push(falseFromTarget);
  }

  // Distractor 2: If there is another sentence in the document, negate that sentence or cross-attribute its predicate
  if (allSentences.length > 1) {
    const otherSentence = allSentences[(seed + 1) % allSentences.length];
    if (normalizeText(otherSentence.text) !== normalizeText(sObj.text)) {
      const otherSplit = splitSentenceAroundKeyword(
        otherSentence.text,
        otherSentence.keywords[0] || kwB
      );
      const negatedOther = buildNaturalFalseStatement(otherSentence, otherSplit, kwB, difficulty);
      if (
        normalizeText(negatedOther) !== normalizeText(sObj.text) &&
        !distractors.some(d => normalizeText(d) === normalizeText(negatedOther))
      ) {
        distractors.push(negatedOther);
      }
    }
  }

  // Distractor 3 & Fallback templates using actual document terminology without repeating words from `concept`
  const distinctTarget =
    sObj.keywords.find(k => !normalizeText(concept).includes(normalizeText(k))) || kwA;
  const candidateTemplates = [
    `En relación con «${sObj.topicTitle}», el planteamiento sobre «${concept}» descarta la participación de «${distinctTarget}» y se limita a un registro preliminar aislado.`,
    `Según el apartado «${sObj.topicTitle}», «${concept}» constituye un procedimiento secundario opcional que prescinde del análisis de «${kwB}».`,
    `El documento sostiene que «${concept}» opera de manera independiente, excluyendo cualquier vinculación técnica o metodológica con «${kwC}».`,
    `Dentro del estudio de «${sObj.topicTitle}», se establece que «${concept}» carece de relevancia diagnóstica o analítica frente a «${distinctTarget}».`,
  ];

  for (const cand of candidateTemplates) {
    if (distractors.length >= 3) break;
    if (
      normalizeText(cand) !== normalizeText(sObj.text) &&
      !distractors.some(d => normalizeText(d) === normalizeText(cand))
    ) {
      distractors.push(cand);
    }
  }

  return distractors.slice(0, 3);
}

/**
 * Generates questions 100% exclusively from the active documents passed in `docs`.
 * Every generated question includes `topicTitle` (Título de la Temática) and complete, logical questions and answers
 * across all 4 difficulties (Fácil, Medio, Difícil, Jacqueline) and all 4 modalities.
 */
export function generateFallbackQuestions(
  docs: UploadedDoc[],
  config: QuizConfig
): Question[] {
  const { selectedModalities, difficulty, questionCount } = config;
  const isJacqueline = difficulty === 'jacqueline';
  const activeDocs = docs && docs.length > 0 ? docs : PRESET_SAMPLE_DOCUMENTS;
  const allowedModalities: QuestionModality[] =
    selectedModalities && selectedModalities.length > 0 ? selectedModalities : ['multiple_choice'];

  // Curated questions ONLY for preset sample documents that are actually present in activeDocs
  const activeDocNames = new Set(activeDocs.map(d => d.name));
  const presetPool: Question[] = [
    {
      id: 'q-mc-1',
      type: 'multiple_choice',
      difficulty: isJacqueline ? 'jacqueline' : 'dificil',
      topicTitle: 'Respiración Celular y Fosforilación Oxidativa',
      prompt: isJacqueline
        ? 'En la cadena de transporte de electrones mitocondrial (según los apuntes manuscritos de biología), ¿por qué razón molecular específica el Complejo II (succinato deshidrogenasa) es incapaz de contribuir directamente a la formación del gradiente electroquímico de protones en el espacio intermembrana?'
        : '¿Cuál de los siguientes complejos enzimáticos de la respiración celular mitocondrial NO bombea protones al espacio intermembrana?',
      options: [
        'Complejo II (Succinato deshidrogenasa)',
        'Complejo I (NADH deshidrogenasa)',
        'Complejo III (Citocromo bc1)',
        'Complejo IV (Citocromo c oxidasa)'
      ],
      correctAnswer: 'Complejo II (Succinato deshidrogenasa)',
      officialAnswer: 'El Complejo II (succinato deshidrogenasa) transfiere electrones desde el FADH2 hacia la ubiquinona sin translocación de protones a través de la membrana interna.',
      explanation: 'Tal como se enfatiza en las notas manuscritas del profesor al margen del cuaderno: el Complejo II no bombea protones directamente, a diferencia de los complejos I, III y IV.',
      sourceDocName: 'Apuntes_Manuscritos_Biologia_Celular.jpg',
      sourceSection: 'Respiración Celular y Fosforilación Oxidativa'
    },
    {
      id: 'q-mc-2',
      type: 'multiple_choice',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
      topicTitle: 'Mecanismo de Multi-Head Scaled Dot-Product Attention',
      prompt: 'En la arquitectura Transformer (conforme a las diapositivas PPTX), ¿cuál es el propósito matemático de dividir los productos punto por sqrt(d_k) en la función de atención escalada?',
      options: [
        'Evitar magnitudes excesivas que empujen el softmax a regiones con gradientes evanescentes',
        'Invertir la matriz de atención para asegurar ortogonalidad en los embeddings',
        'Normalizar los tokens según su frecuencia en el vocabulario de entrenamiento',
        'Reducir la complejidad temporal de O(N^2) a O(N log N)'
      ],
      correctAnswer: 'Evitar magnitudes excesivas que empujen el softmax a regiones con gradientes evanescentes',
      officialAnswer: 'El factor 1/sqrt(d_k) contrae la escala del producto punto Q*K^T cuando d_k es grande, evitando saturación de la función softmax donde las derivadas son casi nulas.',
      explanation: 'Explicado en la Diapositiva 12: para valores grandes de d_k los productos punto crecen en magnitud, desplazando la función softmax a zonas de pendiente nula.',
      sourceDocName: 'Presentacion_Arquitecturas_LLM_Transformers.pptx',
      sourceSection: 'Mecanismo de Multi-Head Scaled Dot-Product Attention'
    },
    {
      id: 'q-mc-3',
      type: 'multiple_choice',
      difficulty: isJacqueline ? 'jacqueline' : 'facil',
      topicTitle: 'El Bloque de Constitucionalidad y Control de Convencionalidad',
      prompt: 'Según el documento de Derecho Constitucional, ¿en qué caso hito la Corte Interamericana de Derechos Humanos consagró el deber judicial del control de convencionalidad "ex officio"?',
      options: [
        'Caso Almonacid Arellano vs. Chile (2006)',
        'Caso Marbury vs. Madison (1803)',
        'Caso Velásquez Rodríguez vs. Honduras (1888)',
        'Caso Barrios Altos vs. Perú (2001)'
      ],
      correctAnswer: 'Caso Almonacid Arellano vs. Chile (2006)',
      officialAnswer: 'El Caso Almonacid Arellano vs. Chile (2006) estableció de manera explícita por primera vez que el Poder Judicial debe ejercer un control de convencionalidad ex officio.',
      explanation: 'Fundamentado en el Capítulo 4 de la guía: Sentencia hito Almonacid Arellano vs. Chile (2006).',
      sourceDocName: 'Guia_Derecho_Constitucional_y_DDHH.pdf',
      sourceSection: 'El Bloque de Constitucionalidad y Control de Convencionalidad'
    },
    {
      id: 'q-mc-4',
      type: 'multiple_choice',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
      topicTitle: 'El Ciclo de Calvin-Benson en el Estroma del Cloroplasto',
      prompt: 'En el Ciclo de Calvin ilustrado en el esquema de Canva, ¿cuántas moléculas de Gliceraldehído-3-Fosfato (G3P) se reciclan para regenerar RuBP por cada 6 sintetizadas?',
      options: [
        '5 moléculas de G3P',
        '1 molécula de G3P',
        '3 moléculas de G3P',
        '6 moléculas de G3P'
      ],
      correctAnswer: '5 moléculas de G3P',
      officialAnswer: 'Por cada 6 moléculas de G3P formadas en la fase de reducción, 5 se destinan al reciclaje y regeneración de RuBP, dejando una ganancia neta de 1 G3P.',
      explanation: 'Confirmado en la Fase 3 del diagrama: 5 de cada 6 G3P se reciclan estequiométricamente.',
      sourceDocName: 'Infografia_Canva_Ciclo_Calvin_Fotosintesis.png',
      sourceSection: 'Fase 3: Regeneración de RuBP'
    },
    {
      id: 'q-tf-1',
      type: 'true_false',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
      topicTitle: 'Control de Convencionalidad Ex Officio y Principio Pro Persona',
      prompt: isJacqueline
        ? 'Bajo el principio pro homine y la jurisprudencia de la Corte IDH, los jueces nacionales sólo están obligados a ejercer control de convencionalidad si una de las partes en litigio lo solicita expresamente.'
        : 'El control de convencionalidad debe ser ejercido de oficio ("ex officio") por los jueces nacionales, incluso sin petición expresa de las partes.',
      options: ['Verdadero', 'Falso'],
      correctAnswer: isJacqueline ? 'Falso' : 'Verdadero',
      officialAnswer: 'El control de convencionalidad es un deber "ex officio" del Poder Judicial.',
      explanation: 'El Caso Almonacid Arellano resolvió que los jueces deben ejercer dicho control ex officio.',
      sourceDocName: 'Guia_Derecho_Constitucional_y_DDHH.pdf',
      sourceSection: 'Control de Convencionalidad ex officio'
    },
    {
      id: 'q-tf-2',
      type: 'true_false',
      difficulty: isJacqueline ? 'jacqueline' : 'facil',
      topicTitle: 'ATP Sintasa y Fuerza Protón-Motriz Mitocondrial',
      prompt: 'En la ATP Sintasa mitocondrial (Complejo V), la rotación mecánica del rotor molecular es impulsada directamente por la fuerza protón-motriz generada por el gradiente de H+.',
      options: ['Verdadero', 'Falso'],
      correctAnswer: 'Verdadero',
      officialAnswer: 'Verdadero. La ATP Sintasa opera biomecánicamente como una turbina molecular giratoria impulsada por el flujo de protones.',
      explanation: 'Anotación manuscrita destacada: "ATP Sintasa funciona como una turbina molecular giratoria impulsada por fuerza protón-motriz".',
      sourceDocName: 'Apuntes_Manuscritos_Biologia_Celular.jpg',
      sourceSection: 'ATP Sintasa y Fuerza Protón-Motriz'
    },
    {
      id: 'q-tf-3',
      type: 'true_false',
      difficulty: isJacqueline ? 'jacqueline' : 'dificil',
      topicTitle: 'Codificación Posicional (Positional Encoding) en Transformers',
      prompt: 'La arquitectura Transformer prescinde de positional encodings porque el mecanismo de atención autoregresiva ya deduce intrínsecamente el orden temporal de las secuencias.',
      options: ['Verdadero', 'Falso'],
      correctAnswer: 'Falso',
      officialAnswer: 'Falso. Al no poseer recurrencia temporal como las RNNs, los Positional Encodings son estrictamente indispensables para inyectar orden secuencial.',
      explanation: 'Las diapositivas explican que al procesar tokens en paralelo sin recurrencia temporal, es imperativo codificar la posición relativa/absoluta explícitamente.',
      sourceDocName: 'Presentacion_Arquitecturas_LLM_Transformers.pptx',
      sourceSection: 'Diapositiva 12 - Positional Encoding'
    },
    {
      id: 'q-tf-4',
      type: 'true_false',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
      topicTitle: 'Fotorrespiración y Actividad Oxigenasa de RuBisCO',
      prompt: 'La actividad oxigenasa de la enzima RuBisCO en plantas C3 aumenta la eficiencia fotosintética al generar ATP adicional durante el estrés térmico.',
      options: ['Verdadero', 'Falso'],
      correctAnswer: 'Falso',
      officialAnswer: 'Falso. La actividad oxigenasa de RuBisCO desencadena fotorrespiración (Ciclo C2), reduciendo la eficiencia fotosintética hasta un 25%.',
      explanation: 'La infografía de Canva subraya que la fotorrespiración reduce la eficiencia neta hasta un 25% en plantas C3 bajo estrés térmico.',
      sourceDocName: 'Infografia_Canva_Ciclo_Calvin_Fotosintesis.png',
      sourceSection: 'Fotorrespiración en Plantas C3'
    },
    {
      id: 'q-fib-1',
      type: 'fill_blank',
      difficulty: isJacqueline ? 'jacqueline' : 'facil',
      topicTitle: 'Principio Pro Persona en Derechos Humanos (Art. 29 CADH)',
      prompt: 'Completa la palabra clave faltante sobre el principio de interpretación de Derechos Humanos:',
      fillInContext: {
        sentenceBefore: 'El criterio hermenéutico que impone la aplicación de la interpretación jurídica más favorable a la dignidad del ser humano se conoce como principio',
        targetWord: 'pro persona',
        sentenceAfter: 'y está consagrado en el artículo 29 de la CADH.'
      },
      correctAnswer: 'pro persona',
      officialAnswer: 'Principio Pro Persona (o Pro Homine). Consagrado en el artículo 29 de la CADH.',
      explanation: 'Consagrado en el artículo 29 de la Convención Americana sobre Derechos Humanos (CADH) y citado en el Capítulo 4.',
      sourceDocName: 'Guia_Derecho_Constitucional_y_DDHH.pdf',
      sourceSection: 'Capítulo 4: Principio Pro Persona'
    },
    {
      id: 'q-fib-2',
      type: 'fill_blank',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
      topicTitle: 'Fase 1 del Ciclo de Calvin: Fijación del Carbono',
      prompt: 'Completa el concepto enzimático fundamental del ciclo estromático:',
      fillInContext: {
        sentenceBefore: 'La enzima responsable de fijar el CO2 atmosférico sobre la ribulosa-1,5-bisfosfato (RuBP) en el estroma es la',
        targetWord: 'rubisco',
        sentenceAfter: 'la cual también posee actividad oxigenasa competitiva.'
      },
      correctAnswer: 'rubisco',
      officialAnswer: 'RuBisCO (Ribulosa-1,5-bisfosfato carboxilasa-oxigenasa).',
      explanation: 'Identificado en la Fase 1 de la infografía analizada con OCR multimodal.',
      sourceDocName: 'Infografia_Canva_Ciclo_Calvin_Fotosintesis.png',
      sourceSection: 'Fase 1: Fijación del Carbono'
    },
    {
      id: 'q-fib-3',
      type: 'fill_blank',
      difficulty: isJacqueline ? 'jacqueline' : 'dificil',
      topicTitle: 'Bioenergética Mitocondrial y Gradiente Electroquímico',
      prompt: 'Completa la variable bioenergética manuscrita del apunte:',
      fillInContext: {
        sentenceBefore: 'El gradiente electroquímico de protones que impulsa la síntesis de ATP en la cresta mitocondrial se cuantifica mediante la fuerza',
        targetWord: 'proton-motriz',
        sentenceAfter: '(Δp), compuesta por el potencial eléctrico de membrana y el gradiente de pH.'
      },
      correctAnswer: 'proton-motriz',
      officialAnswer: 'Fuerza protón-motriz (Δp = ΔΨ - 2.3 RT/F ΔpH).',
      explanation: 'Fórmula manuscrita anotada a mano en los apuntes de biología celular.',
      sourceDocName: 'Apuntes_Manuscritos_Biologia_Celular.jpg',
      sourceSection: 'Fórmula bioenergética manuscrita'
    },
    {
      id: 'q-oq-1',
      type: 'open_question',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
      topicTitle: 'Control Difuso vs. Control Concentrado de Constitucionalidad',
      prompt: 'Explica la diferencia jurídica y los alcances prácticos entre el "Control Difuso" y el "Control Concentrado" de constitucionalidad según el documento de estudio.',
      correctAnswer: 'El control difuso es ejercido por cualquier juez con efectos inter partes, mientras que el control concentrado expulsa la norma con efectos erga omnes.',
      officialAnswer: 'Respuesta Oficial del Documento:\n1. Control Difuso: Inaplicativo inter partes.\n2. Control Concentrado: Expulsa la norma con efectos erga omnes.',
      explanation: 'Contraste doctrinal extraído de la Guía de Derecho Constitucional.',
      sourceDocName: 'Guia_Derecho_Constitucional_y_DDHH.pdf',
      sourceSection: 'Control Difuso vs Concentrado'
    },
    {
      id: 'q-oq-2',
      type: 'open_question',
      difficulty: isJacqueline ? 'jacqueline' : 'dificil',
      topicTitle: 'Arquitecturas Decoder-Only y Enmascaramiento Causal',
      prompt: '¿Por qué la arquitectura Decoder-Only (como GPT y Gemini) utiliza enmascaramiento causal ("causal masking") durante la fase de atención?',
      correctAnswer: 'El enmascaramiento causal asegura que durante el entrenamiento autorregresivo la atención hacia cada token sólo pueda computarse respecto a los tokens previos.',
      officialAnswer: 'Respuesta Oficial del Documento:\nEl enmascaramiento causal garantiza que la representación de un token en la posición t solo dependa de las posiciones anteriores (1 a t).',
      explanation: 'Detalle de ingeniería de atención descrito en la diapositiva 15.',
      sourceDocName: 'Presentacion_Arquitecturas_LLM_Transformers.pptx',
      sourceSection: 'Diapositiva 15: Modelos Decoder-Only y Causal Masking'
    },
  ];

  // CRITICAL: Only keep preset questions whose sourceDocName is ACTUALLY in activeDocs!
  const matchingPresets = presetPool.filter(
    q => activeDocNames.has(q.sourceDocName) && allowedModalities.includes(q.type)
  );

  // Extract dynamic sentences, thematic titles & concepts strictly from activeDocs
  const { sentences, allKeywords } = extractDocumentKnowledge(activeDocs);

  const dynamicPool: Question[] = [];

  for (let i = 0; i < Math.max(sentences.length, questionCount * 2); i++) {
    const sObj = sentences[i % sentences.length];
    const modality = allowedModalities[i % allowedModalities.length];
    const primaryKeyword =
      sObj.keywords[i % Math.max(1, sObj.keywords.length)] ||
      allKeywords[i % Math.max(1, allKeywords.length)] ||
      deriveDocumentBaseTopic(sObj.docName);
    const secondaryKeyword =
      sObj.keywords[(i + 1) % Math.max(1, sObj.keywords.length)] ||
      allKeywords[(i + 1) % Math.max(1, allKeywords.length)] ||
      primaryKeyword;

    const split = splitSentenceAroundKeyword(sObj.text, primaryKeyword);
    const topicTitle = sObj.topicTitle || deriveDocumentBaseTopic(sObj.docName);
    const conceptLabel = sObj.conceptPhrase || split.targetWord;

    if (modality === 'multiple_choice') {
      // Build 3 complete, coherent, grammatically natural proposition distractors
      // so the student evaluates full conceptual statements from the document!
      const correctProposition = sObj.text;
      const distractors = buildMultipleChoicePropositionDistractors(
        sObj,
        split,
        sentences,
        allKeywords,
        difficulty,
        i + 1
      );

      const rawOptions = [correctProposition, ...distractors];
      const options = rotateOptions(rawOptions, i + 1);

      let mcPrompt = '';
      if (difficulty === 'jacqueline') {
        mcPrompt = `Dentro del análisis técnico de «${topicTitle}» desarrollado en "${sObj.docName}", ¿cuál de los siguientes postulados fundamenta con exactitud lo establecido en el documento acerca de «${conceptLabel}»?`;
      } else if (difficulty === 'dificil') {
        mcPrompt = `Al analizar el apartado sobre «${topicTitle}» en "${sObj.docName}", ¿cuál de las siguientes proposiciones explica con precisión el alcance y función de «${conceptLabel}»?`;
      } else if (difficulty === 'medio') {
        mcPrompt = `De acuerdo con el desarrollo de «${topicTitle}» en el documento "${sObj.docName}", ¿qué afirmación describe correctamente la relación conceptual de «${conceptLabel}»?`;
      } else {
        mcPrompt = `Según la sección «${topicTitle}» del documento "${sObj.docName}", selecciona el enunciado correcto respecto a «${conceptLabel}»:`;
      }

      dynamicPool.push({
        id: `doc-mc-${i + 1}`,
        type: 'multiple_choice',
        difficulty,
        topicTitle,
        prompt: mcPrompt,
        options,
        correctAnswer: correctProposition,
        officialAnswer: `En "${sObj.docName}" (${topicTitle}) se establece literalmente: «${sObj.text}»`,
        explanation: `Postulado verificado en el documento "${sObj.docName}" dentro del tema «${topicTitle}»: «${sObj.text}»`,
        sourceDocName: sObj.docName,
        sourceSection: topicTitle,
      });
    } else if (modality === 'true_false') {
      // Alternate True and False statements derived strictly from the document
      const makeTrue = i % 2 === 0;
      let statement = sObj.text;
      let explanation = `Confirmado en "${sObj.docName}" (${topicTitle}): «${sObj.text}»`;

      if (!makeTrue) {
        const replacement = allKeywords.find(
          k =>
            !isCorruptedToken(k) &&
            normalizeText(k) !== normalizeText(split.targetWord) &&
            !normalizeText(sObj.text).includes(normalizeText(k)) &&
            k.length >= 4
        );
        statement = buildNaturalFalseStatement(sObj, split, replacement, difficulty);
        explanation = `La afirmación es FALSA porque en "${sObj.docName}" (${topicTitle}) se establece en realidad que: «${sObj.text}»`;
      }

      const tfPrefix =
        difficulty === 'jacqueline'
          ? `Evalúa con rigor técnico según "${sObj.docName}" (${topicTitle}) si la siguiente proposición es Verdadera o Falsa`
          : difficulty === 'dificil'
          ? `Analiza el criterio expuesto en "${sObj.docName}" sobre «${topicTitle}» e indica si es Verdadero o Falso`
          : `De acuerdo con el documento "${sObj.docName}" respecto a «${topicTitle}», indica si el siguiente enunciado es Verdadero o Falso`;

      dynamicPool.push({
        id: `doc-tf-${i + 1}`,
        type: 'true_false',
        difficulty,
        topicTitle,
        prompt: `${tfPrefix}: «${statement}»`,
        options: ['Verdadero', 'Falso'],
        correctAnswer: makeTrue ? 'Verdadero' : 'Falso',
        officialAnswer: `${makeTrue ? 'Verdadero' : 'Falso'}. Referencia documental en "${sObj.docName}" (${topicTitle}): «${sObj.text}»`,
        explanation,
        sourceDocName: sObj.docName,
        sourceSection: topicTitle,
      });
    } else if (modality === 'fill_blank') {
      const fibPrompt =
        difficulty === 'jacqueline'
          ? `Completa con precisión el término técnico central sobre «${topicTitle}» extraído de "${sObj.docName}":`
          : difficulty === 'dificil'
          ? `Identifica y escribe el concepto clave que articula el siguiente postulado sobre «${topicTitle}» en "${sObj.docName}":`
          : `Completa la palabra o concepto clave sobre «${topicTitle}» según el documento "${sObj.docName}":`;

      dynamicPool.push({
        id: `doc-fib-${i + 1}`,
        type: 'fill_blank',
        difficulty,
        topicTitle,
        prompt: fibPrompt,
        fillInContext: {
          sentenceBefore: split.sentenceBefore || `En relación con ${topicTitle}, el documento destaca`,
          targetWord: split.targetWord,
          sentenceAfter: split.sentenceAfter || `como elemento clave en ${sObj.docName}.`,
        },
        correctAnswer: split.targetWord,
        officialAnswer: `Concepto exacto: "${split.targetWord}". Enunciado completo en "${sObj.docName}" (${topicTitle}): «${sObj.text}»`,
        explanation: `Cita directa del apartado "${topicTitle}" en "${sObj.docName}": «${sObj.text}»`,
        sourceDocName: sObj.docName,
        sourceSection: topicTitle,
      });
    } else {
      // open_question
      const nextSentenceObj = sentences[(i + 1) % sentences.length];
      const extraContext =
        nextSentenceObj && nextSentenceObj.docName === sObj.docName && nextSentenceObj.text !== sObj.text
          ? ` ${nextSentenceObj.text}`
          : '';

      let openPrompt = '';
      if (difficulty === 'jacqueline') {
        openPrompt =
          normalizeText(primaryKeyword) !== normalizeText(secondaryKeyword)
            ? `Respecto a la temática «${topicTitle}» en "${sObj.docName}", fundamenta con precisión técnica cómo se articula «${conceptLabel}» con «${secondaryKeyword}» y cuáles son sus implicaciones según el documento.`
            : `Respecto a la temática «${topicTitle}» en "${sObj.docName}", desarrolla exhaustivamente los fundamentos y alcances técnicos de «${conceptLabel}» expuestos en el texto.`;
      } else if (difficulty === 'dificil') {
        openPrompt = `Analiza en profundidad lo expuesto en "${sObj.docName}" sobre la temática «${topicTitle}»: ¿qué función cumple «${conceptLabel}» y cómo se justifica dentro del planteamiento del documento?`;
      } else if (difficulty === 'medio') {
        openPrompt = `De acuerdo con el documento "${sObj.docName}" en el apartado «${topicTitle}», explica en qué consiste «${conceptLabel}» y cómo se relaciona con las ideas principales de esa sección.`;
      } else {
        openPrompt = `Según el documento "${sObj.docName}" dentro del tema «${topicTitle}», describe qué se establece directamente acerca de «${conceptLabel}».`;
      }

      dynamicPool.push({
        id: `doc-oq-${i + 1}`,
        type: 'open_question',
        difficulty,
        topicTitle,
        prompt: openPrompt,
        correctAnswer: sObj.text,
        officialAnswer: `Respuesta Oficial de "${sObj.docName}" (${topicTitle}):\n«${sObj.text}${extraContext}»`,
        explanation: `Fundamentado en la sección "${topicTitle}" del documento "${sObj.docName}".`,
        sourceDocName: sObj.docName,
        sourceSection: topicTitle,
      });
    }
  }

  const combinedPool = [...matchingPresets, ...dynamicPool];
  const result: Question[] = [];
  let idx = 0;

  while (result.length < questionCount && combinedPool.length > 0) {
    const template = combinedPool[idx % combinedPool.length];
    result.push({
      ...template,
      id: `${template.id}-${result.length + 1}`,
      difficulty,
      topicTitle: template.topicTitle || template.sourceSection || deriveDocumentBaseTopic(template.sourceDocName),
    });
    idx++;
  }

  return result.slice(0, questionCount);
}

/**
 * Validates, repairs, and enriches questions returned by any AI engine (`gemini_env`, `gemini_visitor`, `custom_keys`).
 * Guarantees that:
 * 1. Every question has a clear, non-generic `topicTitle` (Título de la temática).
 * 2. Every question belongs strictly to the uploaded `docs`.
 * 3. No question prompt, option, or answer contains PDF CMap corruption (`isCorruptedToken`) or filler like "Ninguno de los conceptos...".
 * 4. Every modality (`multiple_choice`, `true_false`, `fill_blank`, `open_question`) has complete, valid fields.
 */
export function sanitizeAndValidateQuestions(
  rawQuestions: any[],
  docs: UploadedDoc[],
  config: QuizConfig
): Question[] {
  const activeDocs = docs && docs.length > 0 ? docs : PRESET_SAMPLE_DOCUMENTS;
  const fallbackPool = generateFallbackQuestions(activeDocs, config);
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return fallbackPool;
  }

  const validDocNames = new Set(activeDocs.map(d => d.name));
  const defaultDoc = activeDocs[0];
  const allowedModalities: QuestionModality[] =
    config.selectedModalities && config.selectedModalities.length > 0
      ? config.selectedModalities
      : ['multiple_choice'];

  const validated: Question[] = [];

  for (let i = 0; i < rawQuestions.length && validated.length < config.questionCount; i++) {
    const raw = rawQuestions[i];
    if (!raw || typeof raw !== 'object') continue;

    const rawPrompt = cleanExtractedText(String(raw.prompt || '')).trim();
    const promptWords = rawPrompt.split(/\s+/).filter(Boolean);
    const corruptedInPrompt = promptWords.filter(w => isCorruptedToken(w)).length;
    if (!rawPrompt || promptWords.length < 4 || corruptedInPrompt / promptWords.length > 0.15) {
      if (fallbackPool[i]) validated.push(fallbackPool[i]);
      continue;
    }

    const type: QuestionModality = allowedModalities.includes(raw.type)
      ? raw.type
      : allowedModalities[i % allowedModalities.length];

    const matchedDocName =
      raw.sourceDocName && validDocNames.has(raw.sourceDocName)
        ? raw.sourceDocName
        : activeDocs[i % activeDocs.length]?.name || defaultDoc.name;
    const matchedDoc = activeDocs.find(d => d.name === matchedDocName) || defaultDoc;

    // Resolve thematic title (`topicTitle`)
    let topicTitle = cleanExtractedText(
      String(raw.topicTitle || raw.tema || raw.theme || raw.sourceSection || '')
    ).trim();
    if (
      !topicTitle ||
      topicTitle.length < 4 ||
      /^fragmento\s*#/i.test(topicTitle) ||
      isCorruptedToken(topicTitle.split(/\s+/)[0] || '')
    ) {
      topicTitle = deriveDocumentBaseTopic(matchedDoc.name, matchedDoc.analysis?.keyThemes);
    }

    const officialAnswer =
      cleanExtractedText(String(raw.officialAnswer || raw.correctAnswer || '')).trim() ||
      `Referencia oficial verificada en "${matchedDocName}" (${topicTitle}).`;
    const explanation =
      cleanExtractedText(String(raw.explanation || raw.officialAnswer || '')).trim() ||
      `Fundamentado en el apartado "${topicTitle}" del documento "${matchedDocName}".`;

    if (type === 'true_false') {
      const normAns = normalizeText(String(raw.correctAnswer || 'Verdadero'));
      const isFalse = normAns === 'falso' || normAns === 'false' || normAns === 'no';
      validated.push({
        id: String(raw.id || `ai-tf-${i + 1}`),
        type: 'true_false',
        difficulty: config.difficulty,
        topicTitle,
        prompt: rawPrompt,
        options: ['Verdadero', 'Falso'],
        correctAnswer: isFalse ? 'Falso' : 'Verdadero',
        officialAnswer,
        explanation,
        sourceDocName: matchedDocName,
        sourceSection: topicTitle,
      });
    } else if (type === 'multiple_choice') {
      const rawOpts = Array.isArray(raw.options)
        ? raw.options
            .map((o: any) => cleanExtractedText(String(o || '')).trim())
            .filter(
              (o: string) =>
                Boolean(o) &&
                !/ninguno de los conceptos citados/i.test(o) &&
                !o.split(/\s+/).some((w: string) => isCorruptedToken(w))
            )
        : [];

      const cleanCorrect = cleanExtractedText(String(raw.correctAnswer || rawOpts[0] || '')).trim();
      if (
        !cleanCorrect ||
        cleanCorrect.split(/\s+/).some((w: string) => isCorruptedToken(w)) ||
        rawOpts.length < 2
      ) {
        if (fallbackPool[i]) validated.push(fallbackPool[i]);
        continue;
      }

      const finalOpts = [...rawOpts];
      if (!finalOpts.some(o => normalizeText(o) === normalizeText(cleanCorrect))) {
        finalOpts[0] = cleanCorrect;
      }
      while (finalOpts.length < 4) {
        const extra = `Interpretación alternativa no contemplada en el apartado «${topicTitle}» (${finalOpts.length + 1})`;
        if (!finalOpts.includes(extra)) finalOpts.push(extra);
      }

      validated.push({
        id: String(raw.id || `ai-mc-${i + 1}`),
        type: 'multiple_choice',
        difficulty: config.difficulty,
        topicTitle,
        prompt: rawPrompt,
        options: finalOpts.slice(0, 4),
        correctAnswer:
          finalOpts.find(o => normalizeText(o) === normalizeText(cleanCorrect)) || cleanCorrect,
        officialAnswer,
        explanation,
        sourceDocName: matchedDocName,
        sourceSection: topicTitle,
      });
    } else if (type === 'fill_blank') {
      const targetWord = cleanExtractedText(
        String(raw.fillInContext?.targetWord || raw.correctAnswer || '')
      ).trim();
      if (!targetWord || targetWord.split(/\s+/).some(w => isCorruptedToken(w))) {
        if (fallbackPool[i]) validated.push(fallbackPool[i]);
        continue;
      }
      const sentenceBefore = cleanExtractedText(
        String(raw.fillInContext?.sentenceBefore || `En relación con ${topicTitle}, el documento establece que`)
      ).trim();
      const sentenceAfter = cleanExtractedText(
        String(raw.fillInContext?.sentenceAfter || `constituye un concepto fundamental del tema.`)
      ).trim();

      validated.push({
        id: String(raw.id || `ai-fib-${i + 1}`),
        type: 'fill_blank',
        difficulty: config.difficulty,
        topicTitle,
        prompt: rawPrompt,
        fillInContext: {
          sentenceBefore,
          targetWord,
          sentenceAfter,
        },
        correctAnswer: targetWord,
        officialAnswer,
        explanation,
        sourceDocName: matchedDocName,
        sourceSection: topicTitle,
      });
    } else {
      // open_question
      const cleanCorrect = cleanExtractedText(String(raw.correctAnswer || officialAnswer)).trim();
      validated.push({
        id: String(raw.id || `ai-oq-${i + 1}`),
        type: 'open_question',
        difficulty: config.difficulty,
        topicTitle,
        prompt: rawPrompt,
        correctAnswer: cleanCorrect,
        officialAnswer,
        explanation,
        sourceDocName: matchedDocName,
        sourceSection: topicTitle,
      });
    }
  }

  // Top up from fallbackPool if AI returned fewer valid questions than requested
  let fIdx = 0;
  while (validated.length < config.questionCount && fIdx < fallbackPool.length) {
    const candidate = fallbackPool[fIdx++];
    if (!validated.some(q => normalizeText(q.prompt) === normalizeText(candidate.prompt))) {
      validated.push({
        ...candidate,
        id: `${candidate.id}-topup-${validated.length + 1}`,
      });
    }
  }

  return validated.slice(0, config.questionCount);
}
