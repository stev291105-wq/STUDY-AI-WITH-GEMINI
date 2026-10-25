import type { DifficultyLevel, Question, QuestionModality, QuizConfig, QuizSummary, UploadedDoc, UserAnswer } from '../types.ts';
import { cleanExtractedText, isBinaryGarbage } from './documentParser.ts';

const STOPWORDS = new Set([
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
  'mediante', 'durante', 'dentro', 'fuera', 'donde', 'cuando', 'solo', 'sólo', 'cuyo', 'cuya'
]);

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
  sectionLabel: string;
}

/**
 * Extracts meaningful sentences and keywords strictly from the uploaded documents in the current session.
 */
function extractDocumentKnowledge(docs: UploadedDoc[]): {
  sentences: ExtractedSentence[];
  allKeywords: string[];
} {
  const sentences: ExtractedSentence[] = [];
  const keywordCounts = new Map<string, { original: string; count: number }>();

  for (const doc of docs) {
    const parts: string[] = [];

    if (doc.rawText && !isBinaryGarbage(doc.rawText) && !doc.rawText.startsWith('[Imagen multimodal')) {
      parts.push(cleanExtractedText(doc.rawText));
    }
    if (doc.analysis?.summary && !doc.analysis.summary.includes('indexado localmente')) {
      parts.push(doc.analysis.summary);
    }
    if (doc.analysis?.handwrittenNotes?.length) {
      parts.push(...doc.analysis.handwrittenNotes);
    }
    if (doc.analysis?.diagramDescriptions?.length) {
      parts.push(...doc.analysis.diagramDescriptions);
    }

    const fullText = parts.join('\n');
    const rawChunks = fullText
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.replace(/^[\s•\-*]+/, '').trim())
      .filter(s => s.length >= 20 && s.length <= 450);

    for (let idx = 0; idx < rawChunks.length; idx++) {
      const chunk = rawChunks[idx];
      // Extract words >= 4 chars that are not stopwords
      const matches = chunk.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9\-]{4,}/g) || [];
      const chunkKeywords: string[] = [];
      const seenInChunk = new Set<string>();

      for (const word of matches) {
        const lower = word.toLowerCase();
        if (STOPWORDS.has(lower) || /^\d+$/.test(word)) continue;
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

      if (chunkKeywords.length >= 1) {
        sentences.push({
          docName: doc.name,
          text: chunk.endsWith('.') || chunk.endsWith('?') || chunk.endsWith('!') ? chunk : `${chunk}.`,
          keywords: chunkKeywords,
          sectionLabel: `Fragmento #${idx + 1} del documento`,
        });
      }
    }

    // Also include keyThemes if provided
    if (doc.analysis?.keyThemes) {
      for (const theme of doc.analysis.keyThemes) {
        const cleanTheme = theme.trim();
        if (cleanTheme.length >= 3 && !STOPWORDS.has(cleanTheme.toLowerCase())) {
          const lower = cleanTheme.toLowerCase();
          if (!keywordCounts.has(lower)) {
            keywordCounts.set(lower, { original: cleanTheme, count: 2 });
          }
        }
      }
    }

    // If a document had very little text (e.g. an image or title-only file), synthesize factual statements from its themes/name
    if (sentences.filter(s => s.docName === doc.name).length === 0) {
      const baseName = doc.name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim();
      const nameWords = baseName
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
      const kws = nameWords.length > 0 ? nameWords : [baseName || doc.name];
      for (const kw of kws) {
        keywordCounts.set(kw.toLowerCase(), { original: kw, count: 1 });
      }
      sentences.push({
        docName: doc.name,
        text: `El documento "${doc.name}" aborda como tema central ${baseName}.`,
        keywords: kws,
        sectionLabel: 'Contenido principal del documento',
      });
    }
  }

  const allKeywords = Array.from(keywordCounts.values())
    .sort((a, b) => b.count - a.count)
    .map(k => k.original);

  return { sentences, allKeywords };
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
    const words = sentence.split(' ');
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
 * Generates questions 100% exclusively from the active documents passed in `docs`.
 * Never uses unrelated preset questions if those preset documents are not in `docs`.
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
      sourceSection: 'OCR HTR - Notas de clase al margen'
    },
    {
      id: 'q-mc-2',
      type: 'multiple_choice',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
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
      sourceSection: 'Diapositiva 12: Scaled Dot-Product Attention'
    },
    {
      id: 'q-mc-3',
      type: 'multiple_choice',
      difficulty: isJacqueline ? 'jacqueline' : 'facil',
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
      sourceSection: 'Capítulo 4: Bloque de Constitucionalidad'
    },
    {
      id: 'q-mc-4',
      type: 'multiple_choice',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
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
      sourceSection: 'Fase 3: Regeneración del aceptor RuBP'
    },
    {
      id: 'q-tf-1',
      type: 'true_false',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
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
      prompt: 'En la ATP Sintasa mitocondrial (Complejo V), la rotación mecánica del rotor molecular es impulsada directamente por la fuerza protón-motriz generada por el gradiente de H+.',
      options: ['Verdadero', 'Falso'],
      correctAnswer: 'Verdadero',
      officialAnswer: 'Verdadero. La ATP Sintasa opera biomecánicamente como una turbina molecular giratoria impulsada por el flujo de protones.',
      explanation: 'Anotación manuscrita destacada: "ATP Sintasa funciona como una turbina molecular giratoria impulsada por fuerza protón-motriz".',
      sourceDocName: 'Apuntes_Manuscritos_Biologia_Celular.jpg',
      sourceSection: 'Notas HTR al margen'
    },
    {
      id: 'q-tf-3',
      type: 'true_false',
      difficulty: isJacqueline ? 'jacqueline' : 'dificil',
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
      prompt: 'La actividad oxigenasa de la enzima RuBisCO en plantas C3 aumenta la eficiencia fotosintética al generar ATP adicional durante el estrés térmico.',
      options: ['Verdadero', 'Falso'],
      correctAnswer: 'Falso',
      officialAnswer: 'Falso. La actividad oxigenasa de RuBisCO desencadena fotorrespiración (Ciclo C2), reduciendo la eficiencia fotosintética hasta un 25%.',
      explanation: 'La infografía de Canva subraya que la fotorrespiración reduce la eficiencia neta hasta un 25% en plantas C3 bajo estrés térmico.',
      sourceDocName: 'Infografia_Canva_Ciclo_Calvin_Fotosintesis.png',
      sourceSection: 'Nota destacada en infografía'
    },
    {
      id: 'q-fib-1',
      type: 'fill_blank',
      difficulty: isJacqueline ? 'jacqueline' : 'facil',
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

  // Extract dynamic sentences & concepts strictly from activeDocs
  const { sentences, allKeywords } = extractDocumentKnowledge(activeDocs);

  const dynamicPool: Question[] = [];

  for (let i = 0; i < Math.max(sentences.length, questionCount * 2); i++) {
    const sObj = sentences[i % sentences.length];
    const modality = allowedModalities[i % allowedModalities.length];
    const primaryKeyword =
      sObj.keywords[i % Math.max(1, sObj.keywords.length)] ||
      allKeywords[i % Math.max(1, allKeywords.length)] ||
      sObj.docName.replace(/\.[^.]+$/, '');

    const split = splitSentenceAroundKeyword(sObj.text, primaryKeyword);

    if (modality === 'multiple_choice') {
      // Build 3 distractors strictly from concepts in the uploaded documents that do NOT already appear in this sentence
      const normSentence = normalizeText(sObj.text);
      const otherKeywords = allKeywords.filter(
        k =>
          normalizeText(k) !== normalizeText(split.targetWord) &&
          !normSentence.includes(normalizeText(k))
      );
      const fallbackSameDocKeywords = allKeywords.filter(
        k => normalizeText(k) !== normalizeText(split.targetWord)
      );
      const poolForDistractors = otherKeywords.length >= 3 ? otherKeywords : [...otherKeywords, ...fallbackSameDocKeywords];

      const distractors: string[] = [];
      for (let dIdx = 0; dIdx < poolForDistractors.length && distractors.length < 3; dIdx++) {
        const candidate = poolForDistractors[(i + dIdx * 2) % poolForDistractors.length];
        if (
          candidate &&
          normalizeText(candidate) !== normalizeText(split.targetWord) &&
          !distractors.some(existing => normalizeText(existing) === normalizeText(candidate))
        ) {
          distractors.push(candidate);
        }
      }
      const fallbackDistractors = [
        `Ninguno de los conceptos citados en ${sObj.docName}`,
        `Un factor externo no mencionado en ${sObj.docName}`,
        `Concepto opuesto al descrito en el documento`,
      ];
      let fIdx = 0;
      while (distractors.length < 3) {
        distractors.push(fallbackDistractors[fIdx++ % fallbackDistractors.length]);
      }

      const rawOptions = [split.targetWord, ...distractors.slice(0, 3)];
      const options = rotateOptions(rawOptions, i + 1);

      dynamicPool.push({
        id: `doc-mc-${i + 1}`,
        type: 'multiple_choice',
        difficulty,
        prompt: isJacqueline
          ? `[Nivel Jacqueline • Análisis Textual de "${sObj.docName}"] Según el documento cargado, ¿qué término o concepto específico completa con exactitud el siguiente enunciado: «${split.sentenceBefore} [ _____ ] ${split.sentenceAfter}»?`
          : `Según el documento "${sObj.docName}", ¿qué concepto completa correctamente la siguiente afirmación del texto: «${split.sentenceBefore} [ _____ ] ${split.sentenceAfter}»?`,
        options,
        correctAnswer: split.targetWord,
        officialAnswer: `En "${sObj.docName}" se establece textualmente: «${sObj.text}»`,
        explanation: `Extraído directamente de "${sObj.docName}": «${sObj.text}»`,
        sourceDocName: sObj.docName,
        sourceSection: sObj.sectionLabel,
      });
    } else if (modality === 'true_false') {
      // Alternate True and False statements derived strictly from the document
      const makeTrue = i % 2 === 0;
      let statement = sObj.text;
      let explanation = `Confirmado literalmente en "${sObj.docName}": «${sObj.text}»`;

      if (!makeTrue) {
        // Swap primaryKeyword with a distinct keyword from the doc, or negate the statement
        const replacement = allKeywords.find(
          k =>
            normalizeText(k) !== normalizeText(split.targetWord) &&
            k.length >= 4
        );
        if (replacement && split.sentenceBefore) {
          statement = `${split.sentenceBefore} ${replacement} (y en ningún caso ${split.targetWord}) ${split.sentenceAfter}`.trim();
        } else {
          statement = `El documento "${sObj.docName}" afirma que es completamente falso o inexistente que: ${sObj.text}`;
        }
        explanation = `La afirmación es FALSA porque el documento "${sObj.docName}" establece en realidad lo siguiente: «${sObj.text}»`;
      }

      dynamicPool.push({
        id: `doc-tf-${i + 1}`,
        type: 'true_false',
        difficulty,
        prompt: `De acuerdo exclusivamente con el documento "${sObj.docName}", indica si el siguiente enunciado es Verdadero o Falso: «${statement}»`,
        options: ['Verdadero', 'Falso'],
        correctAnswer: makeTrue ? 'Verdadero' : 'Falso',
        officialAnswer: `${makeTrue ? 'Verdadero' : 'Falso'}. Texto original en "${sObj.docName}": «${sObj.text}»`,
        explanation,
        sourceDocName: sObj.docName,
        sourceSection: sObj.sectionLabel,
      });
    } else if (modality === 'fill_blank') {
      dynamicPool.push({
        id: `doc-fib-${i + 1}`,
        type: 'fill_blank',
        difficulty,
        prompt: `Completa la palabra o concepto clave extraído de "${sObj.docName}":`,
        fillInContext: {
          sentenceBefore: split.sentenceBefore || 'Según el documento,',
          targetWord: split.targetWord,
          sentenceAfter: split.sentenceAfter || `(extraído de ${sObj.docName}).`,
        },
        correctAnswer: split.targetWord,
        officialAnswer: `Concepto exacto: "${split.targetWord}". Oración original en "${sObj.docName}": «${sObj.text}»`,
        explanation: `Cita directa de "${sObj.docName}": «${sObj.text}»`,
        sourceDocName: sObj.docName,
        sourceSection: sObj.sectionLabel,
      });
    } else {
      // open_question
      const nextSentenceObj = sentences[(i + 1) % sentences.length];
      const extraContext =
        nextSentenceObj && nextSentenceObj.docName === sObj.docName && nextSentenceObj.text !== sObj.text
          ? ` ${nextSentenceObj.text}`
          : '';

      dynamicPool.push({
        id: `doc-oq-${i + 1}`,
        type: 'open_question',
        difficulty,
        prompt: isJacqueline
          ? `NIVEL JACQUELINE (${sObj.docName}): Desarrolla y fundamenta con precisión lo que expone el documento acerca de «${split.targetWord}» y su relación con el contexto: "${split.sentenceBefore.slice(0, 80)}...".`
          : `Según el documento "${sObj.docName}", explica qué se establece sobre «${split.targetWord}» en relación con este punto del texto.`,
        correctAnswer: sObj.text,
        officialAnswer: `Respuesta Oficial de "${sObj.docName}":\n«${sObj.text}${extraContext}»`,
        explanation: `Fundamentado en el texto íntegro cargado en "${sObj.docName}".`,
        sourceDocName: sObj.docName,
        sourceSection: sObj.sectionLabel,
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
    });
    idx++;
  }

  return result.slice(0, questionCount);
}
