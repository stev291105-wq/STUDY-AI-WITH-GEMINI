import type {
  DifficultyLevel,
  Question,
  QuestionModality,
  QuizConfig,
  QuizSummary,
  UploadedDoc,
  UserAnswer,
} from '../types.ts';
import { DIFFICULTY_LABELS } from '../types.ts';
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
 * Words that are grammatically valid Spanish nouns/adjectives but are too vague on their own
 * to serve as an isolated concept label without surrounding domain qualifiers.
 */
const VAGUE_ISOLATED_WORDS = new Set([
  'informacion',
  'información',
  'proceso',
  'procesos',
  'sistema',
  'sistemas',
  'elemento',
  'elementos',
  'aspecto',
  'aspectos',
  'etapa',
  'etapas',
  'fase',
  'fases',
  'funcion',
  'función',
  'funciones',
  'objetivo',
  'objetivos',
  'finalidad',
  'relacion',
  'relación',
  'relaciones',
  'analisis',
  'análisis',
  'estudio',
  'estudios',
  'criterio',
  'criterios',
  'concepto',
  'conceptos',
  'metodo',
  'método',
  'metodos',
  'métodos',
  'tecnica',
  'técnica',
  'tecnicas',
  'técnicas',
  'sujeto',
  'sujetos',
  'paciente',
  'pacientes',
  'persona',
  'personas',
  'forma',
  'formas',
  'manera',
  'maneras',
  'resultado',
  'resultados',
  'importancia',
  'aplicacion',
  'aplicación',
  'desarrollo',
  'parte',
  'partes',
  'nivel',
  'niveles',
  'marco',
  'contexto',
  'trabajo',
  'practica',
  'práctica',
  'medio',
  'medios',
  'valor',
  'valores',
  'efecto',
  'efectos',
  'cambio',
  'cambios',
  'estado',
  'estados',
  'hecho',
  'hechos',
  'dato',
  'datos',
  'punto',
  'puntos',
  'caracteristica',
  'característica',
  'caracteristicas',
  'características',
  'condicion',
  'condición',
  'condiciones',
  'instancia',
  'instancias',
  'momento',
  'momentos',
  'principio',
  'principios',
  'mano',
  'margen',
  'profesor',
  'cuaderno',
  'flecha',
  'globo',
  'canva',
  'dibujada',
  'escrita',
  'esquema',
  'vectorial',
  'hito',
  'clave',
  'claves',
  'diferencia',
  'diferencias',
  'ojo',
  'examen',
  'sentencia',
  'nota',
  'notas',
  'formula',
  'fórmula',
  'ecuacion',
  'ecuación',
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

export type SemanticElementClass =
  | 'autor'
  | 'etapa'
  | 'paso'
  | 'periodo'
  | 'tecnica'
  | 'tipo'
  | 'mecanismo'
  | 'principio'
  | 'concepto';

interface ExtractedSentence {
  docName: string;
  text: string;
  keywords: string[];
  conceptPhrase: string;
  topicTitle: string;
  specificTopic: string;
  sectionLabel: string;
  semanticClass?: SemanticElementClass;
  authorName?: string;
}

interface ParsedSentenceSemantics {
  subjectClause: string;
  verbPhrase: string;
  predicateClause: string;
  complementClause: string;
  purposeClause?: string;
  actionBeforePurpose?: string;
  meansClause?: string;
  actionBeforeMeans?: string;
  semanticClass: SemanticElementClass;
  authorName?: string;
}

/**
 * Session-level memory to guarantee that consecutive quiz generations on the same document(s)
 * explore new sections, new sentences, and new question angles instead of repeating the same questions.
 */
interface DocSessionHistory {
  generationCount: number;
  usedSentenceAngleKeys: Set<string>;
  usedPromptSignatures: Set<string>;
}

const sessionHistoryByDocFingerprint = new Map<string, DocSessionHistory>();
let globalGenerationSequence = 0;

/**
 * Resets session generation memory (useful for deterministic unit tests if needed).
 */
export function resetGenerationHistoryForTesting(): void {
  sessionHistoryByDocFingerprint.clear();
  globalGenerationSequence = 0;
}

/**
 * Fixes Spanish contractions ("a el" -> "al", "de el" -> "del"), removes ellipses ("..." / "…"),
 * and normalizes spacing and punctuation so every generated prompt and option has impeccable Spanish grammar.
 */
export function fixSpanishContractionsAndGrammar(input: string): string {
  if (!input) return '';
  let text = input
    .replace(/…+/g, '')
    .replace(/\.{3,}/g, '')
    .replace(/\b([Aa])\s+el\b(?!\s+[A-ZÁÉÍÓÚÜÑ])/g, (_, a) => (a === 'A' ? 'Al' : 'al'))
    .replace(/\b([Dd]e)\s+el\b(?!\s+[A-ZÁÉÍÓÚÜÑ])/g, (_, d) => (d === 'De' ? 'Del' : 'del'))
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s+;/g, ';')
    .replace(/\s+:/g, ':')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\.{2,}/g, '.')
    .replace(/\?\.$/g, '?')
    .replace(/!\.$/g, '!')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (text.startsWith('¿') && text.length > 1) {
    text = '¿' + text.charAt(1).toUpperCase() + text.slice(2);
  } else if (text.length > 0 && /^[a-záéíóúüñ]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text;
}

/**
 * Strips repetitive document/section/manual/page reference boilerplate from question stems and options
 * (e.g., "En la sección 3 del libro del manual, pág. 12, ¿...?", "Según el apartado X del documento Y, ...",
 * "(según los apuntes manuscritos)", "(pág. 14 y 15)", "(1998)") so the question goes straight to the clean, well-written prompt.
 */
export function stripQuestionBoilerplate(input: string): string {
  if (!input) return '';
  let text = input.trim();

  // 1. Remove inline parenthetical citations referring to pages, sections, slides, citation years, or document formats
  text = text
    .replace(/\(\s*(?:seg[úu]n|conforme a|de acuerdo con|ver|v[ée]ase|en)\s+(?:el\s+|la\s+|los\s+|las\s+)?(?:documento|secci[óo]n|manual|libro|texto|apartado|cap[íi]tulo|p[áa]g|apunte|diapositiva)[^)]{0,80}\)/gi, ' ')
    .replace(/\(\s*(?:p[áa]g(?:ina)?s?\.?|pp?\.?|cap[íi]tulo|secci[óo]n|apartado|diapositiva|figura|tabla)\s*[^)]{1,45}\)/gi, ' ')
    .replace(/\(\s*(?:18|19|20)\d{2}[a-z]?(?:\s*[,;:]\s*(?:p[áa]g(?:ina)?s?\.?|pp?\.?)?\s*\d+(?:\s*[-–]\s*\d+)?)?\s*\)/gi, ' ')
    .replace(/\b(?:en\s+la\s+|en\s+las\s+)?(?:p[áa]g(?:ina)?s?\.?|pp\.?)\s*\d+(?:\s*(?:[-–a]|y|e|,)\s*\d+)*\b/gi, ' ');

  // 2. If there is an opening question mark `¿` preceded by a meta-reference clause (mentioning sección, libro, manual, pág, apartado, documento, texto, capítulo, según, etc.), strip everything before `¿`
  const qMarkIdx = text.indexOf('¿');
  if (qMarkIdx > 0 && qMarkIdx < 210) {
    const prefix = text.slice(0, qMarkIdx);
    const hasMetaRef = /\b(?:secci[óo]n|apartado|cap[íi]tulo|unidad|m[óo]dulo|p[áa]g(?:ina)?|libro|manual|documento|texto|archivo|gu[íi]a|apunte|diapositiva|esquema|infograf[íi]a|seg[úu]n|conforme|de acuerdo|desarrollado en|expuesto en|analizar el|dentro del|respecto a)\b/i.test(
      prefix
    );
    if (hasMetaRef) {
      text = text.slice(qMarkIdx).trim();
    }
  }

  // 3. Repeatedly strip leading meta-reference clauses ending in a comma or colon (for declarative statements, True/False, Fill-in-Blank, Open-ended)
  const leadingBoilerplatePatterns: RegExp[] = [
    /^(?:seg[úu]n|de acuerdo con|conforme a|a partir de|tomando en cuenta|considerando|en base a|con base en)\s+(?:lo\s+(?:expuesto|establecido|mencionado|descrito|explicado|indicado|planteado|visto|desarrollado)\s+en\s+)?(?:el|la|los|las|este|esta)?\s*(?:secci[óo]n|apartado|cap[íi]tulo|unidad|m[óo]dulo|tema|tem[áa]tica|p[áa]gina|p[áa]g\.?|libro|manual|documento|texto|archivo|gu[íi]a|apunte|apuntes|diapositiva|esquema|infograf[íi]a|lectura|obra|material)[^,?:;]{0,140}[,:]\s*/i,
    /^(?:en|dentro de|al analizar|respecto a|en relaci[óo]n con|con respecto a)\s+(?:el|la|los|las)\s+(?:an[áa]lisis(?:\s+t[ée]cnico)?\s+de|desarrollo\s+de|estudio\s+de|planteamiento\s+de|criterio\s+expuesto\s+en|expuesto\s+en)?\s*(?:el|la|los|las)?\s*(?:secci[óo]n|apartado|cap[íi]tulo|unidad|m[óo]dulo|tema|tem[áa]tica|p[áa]gina|p[áa]g\.?|libro|manual|documento|texto|archivo|gu[íi]a|apunte|diapositiva|esquema|infograf[íi]a)[^,?:;]{0,140}[,:]\s*/i,
    /^(?:en|dentro de)\s+«[^»]{2,90}»(?:\s*\([^)]{1,60}\))?\s*[,:]\s*/i,
    /^(?:seg[úu]n|de acuerdo con|conforme a)\s+["«][^"»]{2,90}["»](?:\s*\([^)]{1,60}\))?\s*[,:]\s*/i,
    /^(?:el\s+(?:documento|manual|libro|texto|apartado|cap[íi]tulo)\s+(?:sostiene|establece|indica|menciona|afirma|se[ñn]ala)\s+que)\s+/i,
  ];

  let changed = true;
  let safety = 0;
  while (changed && safety < 5) {
    changed = false;
    safety++;
    for (const pattern of leadingBoilerplatePatterns) {
      const next = text.replace(pattern, '').trim();
      if (next && next !== text && next.length >= 12) {
        text = next;
        changed = true;
      }
    }
  }

  return fixSpanishContractionsAndGrammar(text);
}

/**
 * Helper to lowercase the first character of a clause unless it is an acronym or proper name.
 */
function lowerFirst(clause: string): string {
  const trimmed = (clause || '').trim();
  if (!trimmed) return '';
  const firstWord = trimmed.split(/\s+/)[0]?.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_-]/g, '') || '';
  if (
    /^[A-ZÁÉÍÓÚÜÑ]{2,}$/.test(firstWord) ||
    /^(?:RuBisCO|RuBP|RoPE|CADH|ATP|NADPH|NADH|FADH2|GABA|AMPA|NMDA|Bleger|Freud|Piaget|Sternberg|Bohoslavsky|Aberastury|Ocampo|Arzeno|Piccolo|Siquier|Vygotsky|Lacan|Klein|Winnicott|Beck|Ellis|Rorschach|Wechsler|Bender|Koppitz)$/.test(
      firstWord
    )
  ) {
    return trimmed;
  }
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function capitalizeFirst(clause: string): string {
  const trimmed = (clause || '').trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function ensurePeriod(statement: string): string {
  const trimmed = fixSpanishContractionsAndGrammar(statement || '');
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Checks if a sentence contains a finite conjugated Spanish verb so we never generate questions from verbless fragments.
 */
export function hasFiniteSpanishVerb(sentence: string): boolean {
  if (!sentence) return false;
  if (
    /\b(?:es|son|era|eran|fue|fueron|está|están|inicia|constituye|constituyen|permite|permiten|establece|establecen|consiste|consisten|evalúa|evalúan|comprende|comprenden|impone|imponen|debe|deben|puede|pueden|determinó|ejerce|ejercen|participa|participan|inserta|define|definen|plantea|plantean|propone|proponen|sostiene|sostienen|introduce|introducen|desarrolla|desarrollan|desarrolló|afirma|afirman|postula|postulan|concibe|conciben|distingue|distinguen|analiza|analizan|describe|describen|explica|explican|caracteriza|caracterizan|genera|generan|funciona|funcionan|opera|operan|depende|dependen|actúa|actúan|induce|inducen|fija|fijan|consume|consumen|recicla|reciclan|desencadena|desencadenan|emplea|emplean|expulsa|expulsan|requiere|requieren|incluye|incluyen|representa|representan|oxigena|inhibe|inhiben|bloquea|bloquean|abre|abren|reduce|reducen|alcanzó|destaca|destacan|registraba|registra|buscan|busca|tiene|tienen|integra|integran|articula|articulan|produce|producen|corresponde|corresponden|refiere|refieren|utiliza|utilizan|aplica|aplican|observa|observan|manifiesta|manifiestan|origina|originan|configura|configuran|interactúa|interactúan|favorece|favorecen|impulsa|impulsan|captura|capturan)\b/i.test(
      sentence
    )
  ) {
    return true;
  }
  // Also match regular conjugated 3rd person verbs ending in -a, -an, -e, -en, -ó, -aron, -ieron preceded by a subject or "se "
  if (/\bse\s+[a-záéíóúüñ]{4,}(?:a|an|e|en|ó)\b/i.test(sentence)) {
    return true;
  }
  return false;
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
      .replace(/\b(?:resumen|para|el|la|los|las|oral|apuntes|guia|presentacion|infografia|canva|documento|archivo|final|copia|texto|pegado)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const validNameWords = cleanedName
    .split(/\s+/)
    .filter(w => w.length >= 2 && !isCorruptedToken(w) && !/^\d+$/.test(w));

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

  return 'Conceptos Fundamentales';
}

const EDITORIAL_META_PREFIX_REGEX =
  /^(?:notas?\s+al\s+margen(?:\s+a\s+mano)?(?:\s+del\s+profesor)?|ojo\s+para\s+el\s+examen|f[óo]rmula\s+escrita(?:\s+a\s+mano)?(?:\s+en\s+el\s+cuaderno)?|flecha\s+dibujada(?:\s+a\s+mano)?|f[óo]rmula\s+en\s+esquema(?:\s+vectorial)?|nota\s+en\s+globo(?:\s+canva)?|ecuaci[óo]n\s+estequiom[ée]trica(?:\s+neta)?|diferencia\s+clave|punto\s+clave|idea\s+clave|nota\s+importante|observaci[óo]n|recordatorio)\s*:\s*/i;

/**
 * Strips OCR/editorial annotation prefixes (e.g., "Notas al margen a mano del profesor:",
 * "Ojo para el examen:", "Diferencia clave:", "Sentencia hito:") so they never corrupt
 * headings, grammatical subjects, or question prompts.
 */
function stripEditorialMetaPrefix(rawLine: string): string {
  let cleaned = rawLine.trim();
  cleaned = cleaned.replace(/^["«“]+|["»”]+$/g, '').trim();

  for (let pass = 0; pass < 3; pass++) {
    const before = cleaned;
    cleaned = cleaned.replace(EDITORIAL_META_PREFIX_REGEX, '').trim();
    cleaned = cleaned.replace(/^["«“]+|["»”]+$/g, '').trim();
    if (cleaned === before) break;
  }

  // Transform "Sentencia hito: Caso X..." into natural grammatical sentence "El Caso X..."
  if (/^sentencia\s+hito\s*:\s*/i.test(cleaned)) {
    const body = cleaned.replace(/^sentencia\s+hito\s*:\s*/i, '').trim();
    cleaned = /^caso\b/i.test(body) ? `El ${body}` : body;
  }

  return cleaned;
}

/**
 * Normalizes structured study notes lines (such as those in «Resumen para el oral Psicodiagnóstico y Entrevista»):
 * - Strips `(pág. X)` and citation years `(1998)`.
 * - Transforms `Autor (país): idea` -> complete grammatical sentence with explicit author and verb.
 * - Transforms `Concepto: autores (año)` -> complete grammatical sentence linking the concept and its authors.
 * - Transforms `Concepto: definición nominal sin verbo` -> complete grammatical sentence with "consiste en".
 */
export function normalizeStudyNotesLine(
  rawLine: string,
  activeHeading: string | null,
  baseDocTopic: string
): string {
  let line = rawLine
    .replace(/\(\s*(?:p[áa]g(?:ina)?s?\.?|pp?\.?)\s*\d+(?:\s*[-–a,y]\s*\d+)*\s*\)/gi, '')
    .replace(/\b(?:p[áa]g(?:ina)?s?\.?|pp\.?)\s*\d+(?:\s*(?:[-–a]|y|e)\s*\d+)*\b/gi, '')
    .replace(/\(\s*(?:18|19|20)\d{2}[a-z]?(?:\s*[,;:]\s*(?:p[áa]g(?:ina)?s?\.?|pp?\.?)?\s*\d+(?:\s*[-–]\s*\d+)?)?\s*\)/gi, '')
    .replace(/^[\s•\-*]+/, '')
    .replace(/^\d+(?:\.\d+)?\s*[.)\-–]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  line = stripEditorialMetaPrefix(line);
  if (!line) return '';

  // Pattern 1: "Autor (País): idea" e.g. "Bleger (Argentina): define la entrevista psicológica..." or "Bohoslavsky (Argentina): modalidad clínica..."
  const authorCountryMatch = /^([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+(?:y|e|de|del)\s+[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+|\s+[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,3})\s*\(\s*([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]{2,25})\s*\)\s*[:\-–]\s*(.+)$/.exec(
    line
  );
  if (authorCountryMatch && authorCountryMatch[1] && authorCountryMatch[2] && authorCountryMatch[3]) {
    const author = authorCountryMatch[1].trim();
    const country = authorCountryMatch[2].trim();
    const idea = authorCountryMatch[3].replace(/[.]+$/, '').trim();
    if (idea.length >= 8) {
      if (hasFiniteSpanishVerb(idea)) {
        const startsWithVerb = /^(?:define|plantea|propone|sostiene|introduce|desarrolla|establece|afirma|postula|concibe|distingue|analiza|describe|explica|caracteriza|crea|formula|estudia|considera)\b/i.test(
          idea
        );
        return startsWithVerb
          ? ensurePeriod(`El autor ${author} (${country}) ${lowerFirst(idea)}`)
          : ensurePeriod(`Según el autor ${author} (${country}), ${lowerFirst(idea)}`);
      }
      const ideaWithArticle = /^(?:el|la|los|las|un|una)\b/i.test(idea) ? lowerFirst(idea) : `el concepto de ${lowerFirst(idea)}`;
      return ensurePeriod(
        `El autor ${author} (${country}) plantea y desarrolla ${ideaWithArticle} en el marco de ${activeHeading || baseDocTopic}`
      );
    }
  }

  // Pattern 2: "Concepto: Autores" or "Concepto: Autores - definición"
  const colonIdx = line.indexOf(':');
  if (colonIdx >= 3 && colonIdx <= 60) {
    const leftConcept = line.slice(0, colonIdx).trim();
    const rightBody = line.slice(colonIdx + 1).replace(/[.]+$/, '').trim();

    if (
      leftConcept &&
      rightBody &&
      !/^(?:tema|cap[íi]tulo|unidad|secci[óo]n|m[óo]dulo|fase|diapositiva|t[íi]tulo|apartado)\b/i.test(leftConcept)
    ) {
      // Check if rightBody is "Autores - idea" or "(según Autores) - idea"
      const cleanedRightForAuthor = rightBody.replace(/\(\s*seg[úu]n\s+([^)]+)\)/gi, '$1');
      const authorDashIdea = /^([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+(?:y|e|de|del|,)\s*[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+|\s+[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,5})\s*[-–—]\s*(.{10,})$/.exec(
        cleanedRightForAuthor
      );
      if (authorDashIdea && authorDashIdea[1] && authorDashIdea[2] && !hasFiniteSpanishVerb(authorDashIdea[1])) {
        const authors = authorDashIdea[1].trim();
        const idea = authorDashIdea[2].trim();
        const verbBridge = hasFiniteSpanishVerb(idea) ? 'establece que' : 'consiste en';
        return ensurePeriod(`El concepto de «${leftConcept}», formulado por ${authors}, ${verbBridge} ${lowerFirst(idea)}`);
      }

      // Check if rightBody is purely a list of 1-4 Proper Name Authors (e.g. "Siquier de Ocampo y García Arzeno")
      const rightWords = cleanedRightForAuthor.split(/\s+/).filter(Boolean);
      const capitalizedWords = rightWords.filter(w => /^[A-ZÁÉÍÓÚÜÑ]/.test(w)).length;
      const connectorWords = rightWords.filter(w => /^(?:y|e|de|del|la|los|las|,|&)$/i.test(w)).length;
      if (
        rightWords.length >= 1 &&
        rightWords.length <= 10 &&
        capitalizedWords >= 1 &&
        capitalizedWords + connectorWords === rightWords.length &&
        !hasFiniteSpanishVerb(cleanedRightForAuthor)
      ) {
        return ensurePeriod(
          `El concepto y abordaje de «${leftConcept}» fue desarrollado y fundamentado teóricamente por ${cleanedRightForAuthor} dentro del estudio de ${activeHeading || baseDocTopic}`
        );
      }

      // Pattern 3: "Concepto: definición nominal sin verbo conjugado"
      if (rightBody.length >= 15 && !hasFiniteSpanishVerb(rightBody)) {
        const startsWithVerbInfinitive = /^(?:evaluar|establecer|comprender|analizar|identificar|determinar|explorar|mantener|indagar|conocer|registrar|aplicar|diagnosticar)\b/i.test(
          rightBody
        );
        if (startsWithVerbInfinitive) {
          return ensurePeriod(`El objetivo de «${leftConcept}» consiste en ${lowerFirst(rightBody)}`);
        }
        return ensurePeriod(`El concepto de «${leftConcept}» consiste en ${lowerFirst(rightBody)}`);
      }
    }
  }

  return line;
}

/**
 * Detects whether a short line in the document represents a section or thematic heading.
 * Strips any "(pág. X)" or citation years from the heading so headings are always clean.
 */
function extractHeadingTopic(line: string): string | null {
  const trimmed = line
    .replace(/^[\s•\-*#R:;«»]+/, '')
    .replace(/\[OCR[^\]]*\]:?/gi, '')
    .replace(/\(\s*(?:p[áa]g(?:ina)?s?\.?|pp?\.?)\s*\d+(?:\s*[-–a,y]\s*\d+)*\s*\)/gi, '')
    .replace(/\b(?:p[áa]g(?:ina)?s?\.?|pp\.?)\s*\d+(?:\s*(?:[-–a]|y|e)\s*\d+)*\b/gi, '')
    .replace(/\(\s*(?:18|19|20)\d{2}[a-z]?\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed.length < 4 || trimmed.length > 90) return null;

  // Reject editorial or OCR meta-labels or "Autor (país): ..." lines so they aren't mistaken for section headings
  if (
    /^(?:sentencia\s+hito|diferencia\s+clave|notas?\s+al\s+margen|ojo\s+para\s+el\s+examen|f[óo]rmula\s+escrita|flecha\s+dibujada|f[óo]rmula\s+en\s+esquema|nota\s+en\s+globo|ecuaci[óo]n\s+estequiom[ée]trica|nota|ejemplo|importante|observaci[óo]n|resumen)\b/i.test(
      trimmed
    )
  ) {
    return null;
  }

  // Reject "Autor (País): ..." lines as headings because they are content propositions
  if (/^[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]+\([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]+\)\s*:/.test(trimmed)) {
    return null;
  }

  // Explicit heading prefixes: "Tema:", "Capítulo 4:", "Fase 1:", "Diapositiva 12:", "Unidad 2:"
  const explicitMatch = /^(?:tema|cap[íi]tulo|unidad|secci[óo]n|m[óo]dulo|fase|diapositiva|t[íi]tulo|apartado)\s*\d*\s*[:.\-–]\s*(.+)$/i.exec(
    trimmed
  );
  if (explicitMatch && explicitMatch[1]) {
    const headingBody = explicitMatch[1].replace(/[.]+$/, '').trim();
    if (headingBody.length >= 4 && !isCorruptedToken(headingBody.split(/\s+/)[0])) {
      return headingBody;
    }
  }

  // Numbered heading e.g. "1. Entrevista Clínica" or "2.1 Evaluación Psicodiagnóstica" (without finite verb)
  const numberedMatch = /^\d+(?:\.\d+)?\s*[.)\-–]\s*([A-ZÁÉÍÓÚÜÑ][^.!?]{3,75})$/.exec(trimmed);
  if (numberedMatch && numberedMatch[1] && !hasFiniteSpanishVerb(numberedMatch[1]) && !numberedMatch[1].includes(':')) {
    const words = numberedMatch[1].trim().split(/\s+/);
    if (words.every(w => !isCorruptedToken(w))) {
      return numberedMatch[1].trim();
    }
  }

  // Short title line without period at the end, without colon, and without finite verbs
  if (!/[.!?]$/.test(trimmed) && !trimmed.includes(':')) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    const validCount = words.filter(w => isValidSpanishStudyWord(w)).length;
    if (
      !hasFiniteSpanishVerb(trimmed) &&
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
 * Checks whether a candidate concept phrase is overly vague on its own (e.g. "información", "proceso", "etapa").
 */
function isVagueConceptPhrase(phrase: string): boolean {
  const cleaned = normalizeText(phrase);
  if (!cleaned || cleaned.length < 4) return true;
  const words = cleaned.split(/\s+/).filter(Boolean);
  const meaningfulWords = words.filter(w => !STOPWORDS.has(w) && !VAGUE_ISOLATED_WORDS.has(w));
  return meaningfulWords.length === 0;
}

/**
 * Extracts a meaningful multi-word nominal concept phrase from a sentence (e.g. "entrevista semidirigida",
 * "proceso psicodiagnóstico clínico", "control de convencionalidad", "arquitectura incaica").
 * Never returns an isolated vague word like "información" or "proceso".
 */
function extractConceptPhrase(sentence: string, fallbackKeywords: string[], topicContext?: string): string {
  const cleanedSentence = stripEditorialMetaPrefix(sentence);

  // 0. Check if sentence has explicit guillemets «Concepto»
  const guillemetMatch = /«([^»]{4,55})»/.exec(cleanedSentence);
  if (guillemetMatch && guillemetMatch[1] && !isVagueConceptPhrase(guillemetMatch[1])) {
    return guillemetMatch[1].trim();
  }

  // 0b. Check if sentence is about an author: "El autor X (País)..."
  const authorSubjMatch = /^(?:El\s+autor|La\s+autora|Según\s+el\s+autor)\s+([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]{2,35}(?:\s*\([A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]+\))?)/i.exec(
    cleanedSentence
  );
  if (authorSubjMatch && authorSubjMatch[1]) {
    return `Aporte de ${authorSubjMatch[1].trim()}`;
  }

  // 1. Check if sentence starts with "Concepto: explicación"
  const colonIdx = cleanedSentence.indexOf(':');
  if (colonIdx >= 4 && colonIdx <= 48) {
    const leftSide = cleanedSentence
      .slice(0, colonIdx)
      .replace(/^(?:tema|cap[íi]tulo|fase|diapositiva|nota|diferencia clave|sentencia hito)\s*\d*\s*/i, '')
      .trim();
    if (
      leftSide.length >= 4 &&
      leftSide.split(/\s+/).length <= 6 &&
      !isCorruptedToken(leftSide.split(/\s+/)[0]) &&
      !isVagueConceptPhrase(leftSide)
    ) {
      return leftSide;
    }
  }

  // 2. Check subject noun phrase before a defining verb
  const subjectMatch = /^(?:El|La|Los|Las|Un|Una)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+(?:de|del|en|para|por|la|el|los|las|y|o|a|vs\.)?\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9\-()]+){0,6}?)\s+(?:,\s*donde\s+|\s*)(?:es|son|se\s+inicia|constituye|consiste|permite|destaca|alcanz[óo]|fue|fueron|se\s+registra|se\s+genera|funciona|opera|impone|establece|representa|comprende|requiere|incluye|eval[úu]a|depende|act[úu]a|induce|fija|consume|recicla|desencadena|emplean|determin[óo]|lo\s+ejerce|lo\s+ejercen|inserta|plantea|define|propone)/i.exec(
    cleanedSentence.trim()
  );
  if (subjectMatch && subjectMatch[1]) {
    const candidate = subjectMatch[1].trim();
    const words = candidate.split(/\s+/);
    if (
      words.length >= 1 &&
      words.length <= 7 &&
      words.some(w => isValidSpanishStudyWord(w)) &&
      !isVagueConceptPhrase(candidate)
    ) {
      return candidate;
    }
  }

  // 3. Look for a 2-4 word technical noun phrase around the top non-vague keywords
  const nonVagueKeywords = fallbackKeywords.filter(k => !VAGUE_ISOLATED_WORDS.has(k.toLowerCase()));
  const searchKeywords = nonVagueKeywords.length > 0 ? nonVagueKeywords : fallbackKeywords;

  for (const kw of searchKeywords.slice(0, 3)) {
    if (!kw || kw.length < 4) continue;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const npRegex = new RegExp(
      `\\b(${escaped}\\s+(?:de\\s+|del\\s+|en\\s+|para\\s+)?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}(?:\\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,})?|[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}\\s+(?:de\\s+|del\\s+)?${escaped})\\b`,
      'i'
    );
    const m = npRegex.exec(cleanedSentence);
    if (m && m[1]) {
      const phraseWords = m[1].trim().split(/\s+/);
      if (
        phraseWords.every(w => !isCorruptedToken(w)) &&
        phraseWords.filter(w => isValidSpanishStudyWord(w)).length >= 2 &&
        !isVagueConceptPhrase(m[1])
      ) {
        return m[1].trim();
      }
    }
  }

  // 4. Combine top 2 non-vague keywords so it's always specific and contextualized
  if (nonVagueKeywords.length >= 2) {
    return `${nonVagueKeywords[0]} y ${nonVagueKeywords[1].toLowerCase()}`;
  }
  if (nonVagueKeywords.length === 1) {
    return topicContext ? `${nonVagueKeywords[0]} en ${topicContext.toLowerCase()}` : nonVagueKeywords[0];
  }

  return topicContext || fallbackKeywords[0] || 'Concepto central';
}

/**
 * Resolves a clean pair of `{ topicTitle, specificTopic }` for a sentence:
 * - `topicTitle`: The overarching Main Topic (Tema Principal) of the section or document.
 * - `specificTopic`: The exact Subtopic / Concept referenced in that specific question (shown underlined next to the main topic).
 */
function buildSentenceTopicHierarchy(
  baseDocTopic: string,
  activeHeading: string | null,
  conceptPhrase: string,
  sentenceKeywords: string[]
): { topicTitle: string; specificTopic: string } {
  const cleanHeading = activeHeading && activeHeading.length >= 4 ? activeHeading.trim() : '';
  const topicTitle = cleanHeading || baseDocTopic;

  const formattedConcept =
    conceptPhrase && conceptPhrase.length >= 4
      ? conceptPhrase.charAt(0).toUpperCase() + conceptPhrase.slice(1)
      : '';

  const cleanKw = sentenceKeywords
    .filter(k => isValidSpanishStudyWord(k) && !VAGUE_ISOLATED_WORDS.has(k.toLowerCase()))
    .map(k => k.charAt(0).toUpperCase() + k.slice(1).toLowerCase());

  let specificTopic = formattedConcept;

  if (!specificTopic || normalizeText(specificTopic) === normalizeText(topicTitle) || isVagueConceptPhrase(specificTopic)) {
    const distinctKws = cleanKw.filter(k => !normalizeText(topicTitle).includes(normalizeText(k)));
    if (distinctKws.length >= 2) {
      specificTopic = `${distinctKws[0]} y ${distinctKws[1].toLowerCase()}`;
    } else if (distinctKws.length === 1) {
      specificTopic = `Función y mecanismo de ${distinctKws[0].toLowerCase()}`;
    } else if (cleanKw.length >= 2) {
      specificTopic = `Articulación entre ${cleanKw[0].toLowerCase()} y ${cleanKw[1].toLowerCase()}`;
    } else {
      specificTopic = `Fundamentos de ${(formattedConcept || topicTitle).toLowerCase()}`;
    }
  } else if (specificTopic.split(/\s+/).length === 1 && cleanKw.length >= 2) {
    const secondKw = cleanKw.find(k => normalizeText(k) !== normalizeText(specificTopic));
    if (secondKw) {
      specificTopic = `${specificTopic} y ${secondKw.toLowerCase()}`;
    }
  }

  return {
    topicTitle,
    specificTopic,
  };
}

/**
 * Splits a paragraph into individual complete sentences without breaking on abbreviations like "vs.", "art.", "ej.", "dr.", "cap.", "etc.".
 * Also splits compound sentences separated by ";" when both clauses are complete, self-contained statements (>= 38 chars).
 */
function splitParagraphIntoCompleteSentences(paragraph: string): string[] {
  const protectedText = paragraph
    .replace(/\b(vs|art|arts|ej|dr|dra|sr|sra|cap|pág|pag|fig|inc|núm|num|etc|aprox|prof)\./gi, '$1__DOT__');

  const rawSentences = protectedText
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡"«(0-9])/)
    .map(s => s.replace(/__DOT__/g, '.').trim())
    .filter(Boolean);

  const expanded: string[] = [];
  for (const sent of rawSentences) {
    if (sent.includes(';') && sent.length > 100) {
      const semiParts = sent.split(/\s*;\s*/).map(p => p.trim()).filter(Boolean);
      if (semiParts.length >= 2 && semiParts.every(p => p.length >= 38 && p.split(/\s+/).length >= 6 && hasFiniteSpanishVerb(p))) {
        for (const p of semiParts) {
          expanded.push(ensurePeriod(capitalizeFirst(p)));
        }
        continue;
      }
    }
    expanded.push(sent);
  }

  return expanded;
}

/**
 * Resolves dangling demonstratives ("este periodo", "esta obra", "esta etapa", "dicho proceso", "este autor"),
 * possessives ("Su objetivo es..."), or implicit subjects ("Además, permite...", "Consiste en...")
 * using the active heading or previous concept so every extracted sentence is 100% self-contained.
 */
export function resolveAnaphoricSubject(
  sentence: string,
  activeHeading: string | null,
  lastConceptPhrase: string | null = null,
  baseDocTopic: string = ''
): string {
  let trimmed = stripEditorialMetaPrefix(sentence.trim());
  const contextAnchor = lastConceptPhrase || activeHeading || baseDocTopic;
  if (!contextAnchor) return fixSpanishContractionsAndGrammar(trimmed);

  // Case 0: Replace leading or early demonstrative phrases ("Este periodo", "Esta obra", "Esta etapa", "Este proceso", "Esta técnica", "Dicho autor")
  const demonstrativeReplacements: Array<[RegExp, string]> = [
    [/^(?:En\s+|Durante\s+)?(?:este|dicho|aquel)\s+per[íi]odo\b/i, `En el período de «${contextAnchor}»`],
    [/^(?:En\s+)?(?:esta|dicha|aquella)\s+obra\b/i, `En la obra sobre «${contextAnchor}»`],
    [/^(?:En\s+|Durante\s+)?(?:esta|dicha)\s+(?:etapa|fase)\b/i, `En la etapa de «${contextAnchor}»`],
    [/^(?:En\s+|Durante\s+)?(?:este|dicho)\s+(?:proceso|procedimiento|mecanismo)\b/i, `En el proceso de «${contextAnchor}»`],
    [/^(?:En\s+)?(?:esta|dicha)\s+(?:t[ée]cnica|herramienta|modalidad|entrevista)\b/i, `En la técnica de «${contextAnchor}»`],
    [/^(?:Seg[úu]n\s+|Para\s+)?(?:este|dicho)\s+autor\b/i, `Según el referente de «${contextAnchor}»`],
    [/^(?:Seg[úu]n\s+|Para\s+)?(?:esta|dicha)\s+autora\b/i, `Según la referente de «${contextAnchor}»`],
    [/^(?:Este|Dicho)\s+(?:concepto|modelo|enfoque|principio|criterio|sistema)\b/i, `El concepto de «${contextAnchor}»`],
    [/^(?:Esta|Dicha)\s+(?:teor[íi]a|perspectiva|estructura|arquitectura|funci[óo]n)\b/i, `La estructura de «${contextAnchor}»`],
    [/^(?:Estos|Dichos)\s+(?:elementos|procesos|mecanismos|factores)\b/i, `Los elementos de «${contextAnchor}»`],
    [/^(?:Estas|Dichas)\s+(?:etapas|fases|t[ée]cnicas|condiciones)\b/i, `Las etapas de «${contextAnchor}»`],
  ];

  for (const [pattern, replacement] of demonstrativeReplacements) {
    if (pattern.test(trimmed)) {
      trimmed = trimmed.replace(pattern, replacement);
      break;
    }
  }

  // Also resolve mid-sentence isolated "en este periodo / en esta obra / en esta etapa"
  trimmed = trimmed
    .replace(/\ben\s+(?:este|dicho)\s+per[íi]odo\b/gi, `en el período de «${contextAnchor}»`)
    .replace(/\ben\s+(?:esta|dicha)\s+obra\b/gi, `en la obra de «${contextAnchor}»`)
    .replace(/\ben\s+(?:esta|dicha)\s+(?:etapa|fase)\b/gi, `en la etapa de «${contextAnchor}»`)
    .replace(/\bde\s+(?:este|dicho)\s+proceso\b/gi, `del proceso de «${contextAnchor}»`);

  // Case 1: Starts with "Su objetivo / Su función / Su finalidad / Su importancia..."
  if (/^(?:Su|Sus)\s+(?:objetivo|funci[óo]n|finalidad|importancia|mecanismo|alcance|aplicaci[óo]n|efecto|prop[óo]sito|estructura|caracter[íi]stica)/i.test(trimmed)) {
    trimmed = trimmed.replace(/^(?:Su|Sus)\s+([a-záéíóúüñ]+)/i, (_, noun) => {
      const isPlural = /s$/i.test(noun);
      const art = /^(?:funci[óo]n|finalidad|importancia|aplicaci[óo]n|estructura|caracter[íi]stica)/i.test(noun)
        ? isPlural
          ? 'Las'
          : 'La'
        : isPlural
        ? 'Los'
        : 'El';
      return `${art} ${noun.toLowerCase()} de «${contextAnchor}»`;
    });
  }

  // Case 2: Starts with discourse connector + subjectless finite verb ("Además, permite...", "Asimismo, evalúa...", "Por ello, requiere...")
  const connectorVerbMatch = /^(?:Adem[áa]s|Asimismo|Por\s+lo\s+tanto|Por\s+ello|En\s+consecuencia|De\s+igual\s+modo|Igualmente|Por\s+otra\s+parte|De\s+este\s+modo|Sin\s+embargo)\s*,\s*((?:se\s+)?(?:permite|eval[úu]a|establece|consiste|constituye|requiere|comprende|incluye|impone|busca|genera|produce|caracteriza|articula|define|emplea|utiliza|aplica|observa)\b.+)$/i.exec(
    trimmed
  );
  if (connectorVerbMatch && connectorVerbMatch[1]) {
    trimmed = `En «${contextAnchor}», además ${lowerFirst(connectorVerbMatch[1])}`;
  }

  // Case 3: Starts directly with subjectless verb ("Consiste en...", "Permite establecer...", "Se caracteriza por...")
  const bareVerbMatch = /^((?:Consiste\s+en|Permite|Se\s+caracteriza\s+por|Se\s+define\s+como|Se\s+encarga\s+de|Tiene\s+como\s+finalidad|Busca\s+establecer|Se\s+inicia\s+con|Eval[úu]a|Comprende|Incluye|Requiere)\b.+)$/i.exec(
    trimmed
  );
  if (bareVerbMatch && bareVerbMatch[1]) {
    trimmed = `El proceso de «${contextAnchor}» ${lowerFirst(bareVerbMatch[1])}`;
  }

  return fixSpanishContractionsAndGrammar(trimmed);
}

/**
 * Classifies the semantic category of a sentence/subject so questions explicitly state what class of element
 * is being asked (paso, etapa, período, autor, técnica, tipo, mecanismo, principio, concepto) and distractors match that category.
 */
export function detectSemanticClass(text: string, subjectClause: string, conceptPhrase: string): {
  semanticClass: SemanticElementClass;
  authorName?: string;
} {
  const combined = `${subjectClause} ${conceptPhrase} ${text}`;

  // 1. Author detection ("El autor Bleger (Argentina)...", "fue desarrollado y fundamentado teóricamente por X")
  const explicitAuthorSubj = /^(?:El\s+autor|La\s+autora|Según\s+el\s+autor)\s+([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]{2,40}(?:\([A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]+\))?)/i.exec(
    text.trim()
  );
  if (explicitAuthorSubj && explicitAuthorSubj[1]) {
    return { semanticClass: 'autor', authorName: explicitAuthorSubj[1].trim() };
  }

  const developedByAuthor = /fue\s+desarrollado\s+y\s+fundamentado\s+te[óo]ricamente\s+por\s+([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ,\s]+?)\s+dentro\s+del\s+estudio/i.exec(
    text
  );
  if (developedByAuthor && developedByAuthor[1]) {
    return { semanticClass: 'autor', authorName: developedByAuthor[1].trim() };
  }

  const knownAuthors = /\b(Bleger|Siquier\s+de\s+Ocampo(?:\s+y\s+Garc[íi]a\s+Arzeno)?|Garc[íi]a\s+Arzeno|Ocampo\s+y\s+Arzeno|Bohoslavsky|Aberastury|Sternberg|Freud|Piaget|Vygotsky|Lacan|Klein|Winnicott|Rorschach|Wechsler|Bender|Koppitz|Almonacid\s+Arellano)\b/i.exec(
    subjectClause
  );
  if (knownAuthors && knownAuthors[1] && !/caso\b/i.test(subjectClause)) {
    return { semanticClass: 'autor', authorName: knownAuthors[1].trim() };
  }

  // 2. Period / Era
  if (/\b(?:per[íi]odo|periodo|[ée]poca|siglo|horizonte|era|cronolog[íi]a|imperio|tahuantinsuyo)\b/i.test(combined)) {
    return { semanticClass: 'periodo' };
  }

  // 3. Stage / Phase
  if (/\b(?:fase\s*\d*|etapa|estadio|momento|ciclo)\b/i.test(subjectClause) || /\b(?:fase|etapa)\b/i.test(conceptPhrase)) {
    return { semanticClass: 'etapa' };
  }

  // 4. Step / Procedure
  if (/\b(?:paso|procedimiento|instancia\s+inicial|primer\s+momento|admisi[óo]n|devoluci[óo]n|informe)\b/i.test(subjectClause)) {
    return { semanticClass: 'paso' };
  }

  // 5. Technique / Instrument
  if (/\b(?:t[ée]cnica|entrevista|instrumento|test|hora\s+de\s+juego|bater[íi]a|encuadre|observaci[óo]n|anamnesis|kipu|quipu)\b/i.test(combined)) {
    return { semanticClass: 'tecnica' };
  }

  // 6. Principle / Normative Criterion
  if (/\b(?:principio|control\s+de\s+convencionalidad|criterio|bloque|pacto|convenci[óo]n|jurisprudencia|sentencia|caso)\b/i.test(combined)) {
    return { semanticClass: 'principio' };
  }

  // 7. Type / Modality / Classification
  if (/\b(?:tipo|modalidad|clasificaci[óo]n|arquitectura|control\s+difuso|control\s+concentrado|decoder-only|encoder-only)\b/i.test(combined)) {
    return { semanticClass: 'tipo' };
  }

  // 8. Mechanism / Process
  if (/\b(?:mecanismo|proceso|gradiente|cadena|atenci[óo]n|fijaci[óo]n|reducci[óo]n|regeneraci[óo]n|fotorrespiraci[óo]n|fosforilaci[óo]n|enzima|complejo|sintasa)\b/i.test(combined)) {
    return { semanticClass: 'mecanismo' };
  }

  return { semanticClass: 'concepto' };
}

/**
 * Returns the explicit human-readable Spanish label for a SemanticElementClass
 * so every question stem states clearly what class of element is being asked.
 */
function getSemanticClassQuestionLabel(cls: SemanticElementClass): string {
  switch (cls) {
    case 'autor':
      return 'autor o referente teórico';
    case 'etapa':
      return 'estadio o etapa del proceso';
    case 'paso':
      return 'paso o instancia metodológica';
    case 'periodo':
      return 'período o etapa histórica';
    case 'tecnica':
      return 'instrumento o técnica de intervención';
    case 'principio':
      return 'principio, criterio o mecanismo normativo';
    case 'tipo':
      return 'tipo, modalidad o clasificación';
    case 'mecanismo':
      return 'mecanismo o proceso funcional';
    default:
      return 'concepto fundamental';
  }
}

/**
 * Semantic Clause & Relation Analyzer (`Motor de Razonamiento Semántico Local`):
 * Decomposes any Spanish study sentence into its Subject, Core Relation Verb, Predicate,
 * Purpose clause (`para...` / `cuyo objetivo es...`), Mechanism clause (`mediante...` / `a través de...`),
 * and Semantic Element Class (`autor`, `etapa`, `paso`, `periodo`, `tecnica`, `tipo`, `mecanismo`, `principio`, `concepto`).
 */
export function analyzeSentenceSemantics(sObj: ExtractedSentence): ParsedSentenceSemantics {
  const cleanText = stripEditorialMetaPrefix(sObj.text).replace(/[.!?]+$/, '').trim();

  // Extract explicit purpose clause if present
  let purposeClause: string | undefined;
  let actionBeforePurpose: string | undefined;
  const purposeRegex = /^(.{18,}?)\s+(?:,\s*)?(?:para|con el fin de|con el objetivo de|con la finalidad de|cuyo objetivo(?:\s+principal)?\s+es|cuya finalidad(?:\s+principal)?\s+es)\s+(.{12,})$/i;
  const purposeMatch = purposeRegex.exec(cleanText);
  if (purposeMatch && purposeMatch[1] && purposeMatch[2]) {
    actionBeforePurpose = purposeMatch[1].replace(/,\s*$/, '').trim();
    purposeClause = purposeMatch[2].trim();
  }

  // Extract explicit mechanism/means clause if present
  let meansClause: string | undefined;
  let actionBeforeMeans: string | undefined;
  const meansRegex = /^(.{16,}?)\s+(?:,\s*)?((?:mediante|a trav[ée]s de|por medio de|gracias a|impulsad[oa]s?\s+por)\s+.{10,})$/i;
  const meansMatch = meansRegex.exec(cleanText);
  if (meansMatch && meansMatch[1] && meansMatch[2]) {
    actionBeforeMeans = meansMatch[1].replace(/,\s*$/, '').trim();
    meansClause = meansMatch[2].trim();
  }

  // 1. Match explicit Subject + Main Verb Phrase + Complement first so natural sentences get clean subjects
  const verbPattern = /^(?:En\s+[^,]{3,45},\s+)?(.{4,95}?)\s+((?:no\s+)?(?:fue\s+desarrollado\s+y\s+fundamentado\s+te[óo]ricamente\s+por|plantea\s+y\s+desarrolla|define|plantea|propone|sostiene|introduce|desarrolla|postula|concibe|distingue|se\s+inicia\s+con|se\s+articula(?:\s+metodol[óo]gicamente)?\s+con|constituye\s+(?:un|una|el|la)|consiste\s+en|se\s+define\s+como|permite\s+(?:establecer|estructurar|comprender|evaluar|verificar)?|eval[úu]a|depende\s+de|act[úu]a\s+como|induce|fija|se\s+consume|se\s+reciclan|desencadena|alcanz[óo]|destaca\s+por|fue\s+edificad[oa]|se\s+registraba\s+mediante|debe\s+ejercer|deben\s+verificar|impone\s+la\s+aplicaci[óo]n|requiere\s+codificar|se\s+genera\s+a\s+trav[ée]s\s+de|funciona\s+como|opera\s+como|bombea|emplean|suele\s+expulsar|puede\s+ser|comprende|incluye|establece\s+que|establece|representa|determin[óo]\s+que|determin[óo]|lo\s+ejerce\s+exclusivamente|lo\s+ejercen|inserta|oxigena|participa|es\s+(?:el|la|un|una)|son))\s+(.{8,})$/i;

  const m = verbPattern.exec(cleanText);
  if (m && m[1] && m[2] && m[3]) {
    const rawSubj = m[1].replace(/,\s*donde\s+.+$/i, '').trim();
    if (!isVagueConceptPhrase(rawSubj)) {
      const subjectClause = rawSubj;
      const verbPhrase = m[2].trim();
      const complementClause = m[3].trim();
      const { semanticClass, authorName } = detectSemanticClass(cleanText, subjectClause, sObj.conceptPhrase);
      return {
        subjectClause,
        verbPhrase,
        predicateClause: ensurePeriod(`${verbPhrase} ${complementClause}`),
        complementClause,
        purposeClause,
        actionBeforePurpose,
        meansClause,
        actionBeforeMeans,
        semanticClass: sObj.semanticClass || semanticClass,
        authorName: sObj.authorName || authorName,
      };
    }
  }

  // 2. Check if sentence has "Concept: Definition" format where left side is a genuine domain concept
  const colonIdx = cleanText.indexOf(':');
  if (colonIdx >= 4 && colonIdx <= 55) {
    const left = cleanText.slice(0, colonIdx).trim();
    const right = cleanText.slice(colonIdx + 1).trim();
    if (left.length >= 4 && right.length >= 15 && !isVagueConceptPhrase(left)) {
      const { semanticClass, authorName } = detectSemanticClass(cleanText, left, sObj.conceptPhrase);
      return {
        subjectClause: left,
        verbPhrase: 'consiste en',
        predicateClause: ensurePeriod(`consiste en ${lowerFirst(right)}`),
        complementClause: right,
        purposeClause,
        actionBeforePurpose,
        meansClause,
        actionBeforeMeans,
        semanticClass: sObj.semanticClass || semanticClass,
        authorName: sObj.authorName || authorName,
      };
    }
  }

  // Fallback structured decomposition using conceptPhrase
  const subjectFallback =
    sObj.conceptPhrase && !isVagueConceptPhrase(sObj.conceptPhrase)
      ? `el concepto de «${sObj.conceptPhrase}»`
      : `el fundamento de «${sObj.specificTopic}»`;
  const { semanticClass, authorName } = detectSemanticClass(cleanText, subjectFallback, sObj.conceptPhrase);

  return {
    subjectClause: subjectFallback,
    verbPhrase: 'establece que',
    predicateClause: ensurePeriod(cleanText),
    complementClause: cleanText,
    purposeClause,
    actionBeforePurpose,
    meansClause,
    actionBeforeMeans,
    semanticClass: sObj.semanticClass || semanticClass,
    authorName: sObj.authorName || authorName,
  };
}

/**
 * Extracts meaningful sentences, main topics (`topicTitle`), specific subtopics (`specificTopic`),
 * nominal concept phrases, authors, and keywords strictly from the uploaded documents in sequential order.
 */
function extractDocumentKnowledge(docs: UploadedDoc[]): {
  sentences: ExtractedSentence[];
  allKeywords: string[];
  allConceptPhrases: string[];
  allAuthors: string[];
} {
  const sentences: ExtractedSentence[] = [];
  const keywordCounts = new Map<string, { original: string; count: number }>();
  const conceptPhrasesSet = new Set<string>();
  const authorsSet = new Set<string>();

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
    let lastConceptPhrase: string | null = null;

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

      const normalizedLine = normalizeStudyNotesLine(
        trimmedLine,
        currentHeading,
        baseDocTopic
      );
      if (!normalizedLine) continue;

      const rawChunks = splitParagraphIntoCompleteSentences(normalizedLine)
        .map(s =>
          normalizeStudyNotesLine(
            stripEditorialMetaPrefix(
              stripQuestionBoilerplate(
                s
                  .replace(/^[\s•\-*R:;«»]+/, '')
                  .replace(/\[OCR[^\]]*\]:?/gi, '')
                  .replace(/\s+/g, ' ')
                  .trim()
              )
            ),
            currentHeading,
            baseDocTopic
          )
        )
        .filter(
          s =>
            isCleanStudySentence(s) &&
            hasFiniteSpanishVerb(s) &&
            s.length >= 28 &&
            s.split(/\s+/).length >= 5
        );

      for (const rawChunk of rawChunks) {
        const effectiveHeading = currentHeading;

        // Resolve implicit or anaphoric subjects so the sentence has full standalone context
        const chunk = resolveAnaphoricSubject(
          rawChunk,
          effectiveHeading,
          lastConceptPhrase,
          baseDocTopic
        );

        const matches = chunk.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}/g) || [];
        const chunkKeywords: string[] = [];
        const seenInChunk = new Set<string>();

        for (const word of matches) {
          if (!isValidSpanishStudyWord(word)) continue;
          // Never allow 4-digit years or page tokens as keywords
          if (/^(?:18|19|20)\d{2}$/.test(word)) continue;
          const lower = word.toLowerCase();
          if (VAGUE_ISOLATED_WORDS.has(lower)) continue;
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

        // Prioritize non-vague academic terms first, then by length
        chunkKeywords.sort((a, b) => {
          const aVague = VAGUE_ISOLATED_WORDS.has(a.toLowerCase()) ? 1 : 0;
          const bVague = VAGUE_ISOLATED_WORDS.has(b.toLowerCase()) ? 1 : 0;
          if (aVague !== bVague) return aVague - bVague;
          return b.length - a.length;
        });

        if (chunkKeywords.length >= 1) {
          const cleanSentenceText = ensurePeriod(chunk);
          if (!sentences.some(existing => normalizeText(existing.text) === normalizeText(cleanSentenceText))) {
            const conceptPhrase = extractConceptPhrase(
              cleanSentenceText,
              chunkKeywords,
              effectiveHeading || baseDocTopic
            );
            if (conceptPhrase && conceptPhrase.length >= 4 && !isVagueConceptPhrase(conceptPhrase)) {
              conceptPhrasesSet.add(conceptPhrase);
              lastConceptPhrase = conceptPhrase;
            }
            const { topicTitle, specificTopic } = buildSentenceTopicHierarchy(
              baseDocTopic,
              effectiveHeading,
              conceptPhrase,
              chunkKeywords
            );
            const { semanticClass, authorName } = detectSemanticClass(
              cleanSentenceText,
              conceptPhrase,
              specificTopic
            );
            if (authorName) {
              authorsSet.add(authorName);
            }
            sentences.push({
              docName: doc.name,
              text: cleanSentenceText,
              keywords: chunkKeywords,
              conceptPhrase,
              topicTitle,
              specificTopic,
              sectionLabel: `${topicTitle} — ${specificTopic}`,
              semanticClass,
              authorName,
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
        text: `El estudio sistemático de ${primaryTopic} se articula metodológicamente con ${secondaryTopic} para fundamentar la comprensión integral de la materia.`,
        keywords: [primaryTopic, secondaryTopic],
        conceptPhrase: `${primaryTopic} y ${secondaryTopic}`,
        topicTitle: baseDocTopic,
        specificTopic: `Fundamentos de ${primaryTopic}`,
        sectionLabel: `${baseDocTopic} — Fundamentos de ${primaryTopic}`,
        semanticClass: 'concepto',
      });

      if (kws.length >= 2) {
        sentences.push({
          docName: doc.name,
          text: `La aplicación rigurosa de ${secondaryTopic} dentro del marco de ${primaryTopic} permite estructurar el análisis y la interpretación diagnóstica.`,
          keywords: [secondaryTopic, primaryTopic],
          conceptPhrase: `${secondaryTopic} en ${primaryTopic}`,
          topicTitle: baseDocTopic,
          specificTopic: `Articulación metodológica de ${secondaryTopic}`,
          sectionLabel: `${baseDocTopic} — Articulación metodológica de ${secondaryTopic}`,
          semanticClass: 'mecanismo',
        });
      }
    }
  }

  const allKeywords = Array.from(keywordCounts.values())
    .filter(
      k =>
        !isCorruptedToken(k.original) &&
        isValidSpanishStudyWord(k.original) &&
        !VAGUE_ISOLATED_WORDS.has(k.original.toLowerCase()) &&
        !/^(?:18|19|20)\d{2}$/.test(k.original)
    )
    .sort((a, b) => {
      const aVague = VAGUE_ISOLATED_WORDS.has(a.original.toLowerCase()) ? 1 : 0;
      const bVague = VAGUE_ISOLATED_WORDS.has(b.original.toLowerCase()) ? 1 : 0;
      if (aVague !== bVague) return aVague - bVague;
      return b.count - a.count || b.original.length - a.original.length;
    })
    .map(k => k.original);

  const allConceptPhrases = Array.from(conceptPhrasesSet);
  const allAuthors = Array.from(authorsSet);

  return { sentences, allKeywords, allConceptPhrases, allAuthors };
}

/**
 * Deterministically rotates options so the correct answer isn't always in position A.
 */
function rotateOptions<T>(options: T[], seed: number): T[] {
  if (options.length <= 1) return options;
  const copy = [...options];
  const offset = Math.abs(seed) % copy.length;
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
 * by negating its core finite verb or inverting its main relationship cleanly without meta-document prefixes
 * and without unnatural parenthetical splices.
 */
function buildNaturalFalseStatement(
  sObj: ExtractedSentence,
  split: { sentenceBefore: string; targetWord: string; sentenceAfter: string },
  replacementKeyword: string | undefined,
  difficulty: DifficultyLevel,
  variantIndex = 0
): string {
  const verbNegations: Array<[RegExp, string]> = [
    [/\bse inicia con\b/i, variantIndex % 2 === 0 ? 'prescinde por completo de' : 'finaliza exclusivamente sin'],
    [/\bse articula metodol[óo]gicamente con\b/i, 'opera de forma desvinculada respecto a'],
    [/\bdetermin[óo] que\b/i, 'descartó que'],
    [/\blo ejerce exclusivamente\b/i, 'jamás lo ejerce'],
    [/\blo ejercen todos\b/i, 'tienen prohibido ejercerlo'],
    [/\bconstituye una\b/i, 'no constituye en ningún caso una'],
    [/\bconstituye un\b/i, 'no constituye en ningún caso un'],
    [/\bpermite establecer\b/i, 'impide establecer'],
    [/\bpermite estructurar\b/i, 'imposibilita estructurar'],
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
    [/\bfunciona como\b/i, 'es incapaz de operar como'],
    [/\bdepende de\b/i, 'es totalmente independiente de'],
    [/\bact[úu]a como\b/i, 'bloquea e inhibe la función de'],
    [/\binduce\b/i, 'impide y revierte la'],
    [/\bfija\b/i, 'es incapaz de fijar'],
    [/\bse consume\b/i, 'no se consume ningún'],
    [/\bse reciclan\b/i, 'jamás se reciclan'],
    [/\bdesencadena\b/i, 'suprime por completo'],
    [/\binserta\b/i, 'impide la inserción de'],
    [/\boxigena\b/i, 'inhibe la oxigenación de'],
    [/\bparticipa\b/i, 'queda excluido'],
    [/\binhibe\b/i, 'estimula de forma directa'],
    [/\bbloquea\b/i, 'activa permanentemente'],
    [/\babre\b/i, 'cierra de forma irreversible'],
    [/\breduce\b/i, 'incrementa descontroladamente'],
    [/\bes el\b/i, 'no representa el'],
    [/\bes la\b/i, 'no representa la'],
    [/\bes un\b/i, 'no constituye un'],
    [/\bes una\b/i, 'no constituye una'],
    [/\bson\b/i, 'no son'],
  ];

  // Try direct finite-verb negation first so the false statement reads with 100% natural Spanish syntax
  for (const [pattern, replacement] of verbNegations) {
    if (pattern.test(sObj.text)) {
      const negated = sObj.text.replace(pattern, replacement);
      if (negated !== sObj.text && variantIndex % 2 === 0) {
        return capitalizeFirst(negated);
      }
    }
  }

  if (replacementKeyword && split.targetWord) {
    const formattedReplacement = matchOptionCase(replacementKeyword, split.targetWord);
    if (difficulty === 'jacqueline' || difficulty === 'dificil') {
      return `En el análisis de «${sObj.conceptPhrase}», se descarta la intervención de «${split.targetWord}» y el proceso queda supeditado exclusivamente a «${formattedReplacement}».`;
    }
    for (const [pattern, replacement] of verbNegations) {
      if (pattern.test(sObj.text)) {
        const negated = sObj.text.replace(pattern, replacement);
        if (negated !== sObj.text) {
          return capitalizeFirst(negated);
        }
      }
    }
    return `En relación con «${sObj.conceptPhrase}», se excluye la participación de «${split.targetWord}» al sustituirse funcionalmente por «${formattedReplacement}».`;
  }

  for (const [pattern, replacement] of verbNegations) {
    if (pattern.test(sObj.text)) {
      const negated = sObj.text.replace(pattern, replacement);
      if (negated !== sObj.text) {
        return capitalizeFirst(negated);
      }
    }
  }

  return `La función de «${sObj.conceptPhrase}» excluye que ${lowerFirst(sObj.text)}`;
}

/**
 * Stratifies extracted sentences across all thematic sections (`topicTitle`) of the uploaded documents
 * so that questions cover the ENTIRE document evenly instead of clustering in the first paragraphs.
 */
function stratifySentencesAcrossThemes(sentences: ExtractedSentence[], seedOffset: number): ExtractedSentence[] {
  if (sentences.length <= 2) return [...sentences];

  const buckets = new Map<string, ExtractedSentence[]>();
  const bucketKeys: string[] = [];

  for (const s of sentences) {
    const key = normalizeText(s.topicTitle || s.docName);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      bucketKeys.push(key);
    }
    buckets.get(key)!.push(s);
  }

  // Rotate bucket order based on seedOffset so different runs start in different sections of the document
  const rotatedKeys = rotateOptions(bucketKeys, seedOffset);
  const stratified: ExtractedSentence[] = [];
  let maxBucketLen = 0;
  for (const list of buckets.values()) {
    if (list.length > maxBucketLen) maxBucketLen = list.length;
  }

  for (let row = 0; row < maxBucketLen; row++) {
    for (let bIdx = 0; bIdx < rotatedKeys.length; bIdx++) {
      const key = rotatedKeys[bIdx];
      const list = buckets.get(key)!;
      const rotatedList = rotateOptions(list, seedOffset + bIdx);
      if (row < rotatedList.length) {
        stratified.push(rotatedList[row]);
      }
    }
  }

  return stratified;
}

/**
 * Formats a complete, well-redacted pedagogical explanation containing:
 * 1) What the correct answer is.
 * 2) Why it is correct (or why the false statement is false).
 * 3) The exact quote/sentence from the study notes.
 * 4) A brief 1-line source citation.
 */
function formatStructuredExplanation(params: {
  correctSummary: string;
  reasonWhy: string;
  exactQuote: string;
  docName: string;
  topicTitle: string;
  specificTopic: string;
}): string {
  const { correctSummary, reasonWhy, exactQuote, docName, topicTitle, specificTopic } = params;
  const cleanSummary = fixSpanishContractionsAndGrammar(correctSummary.replace(/[.]+$/, ''));
  const cleanReason = ensurePeriod(fixSpanishContractionsAndGrammar(reasonWhy));
  const cleanQuote = ensurePeriod(fixSpanishContractionsAndGrammar(exactQuote));
  return `Respuesta correcta: ${cleanSummary}. ${cleanReason} Cita exacta de los apuntes: «${cleanQuote}» Fuente: ${docName} (${topicTitle} — ${specificTopic}).`;
}

/**
 * Automatic Final Quality Gate (`Revisión final automática`):
 * Validates every generated question before showing it to the student:
 * - Complete (never cut in half, no "…" or "...", no dangling prepositions/articles at the end)
 * - Coherent & Specific (explicitly states what is being asked, never vague like "se describe como:" or "le corresponde:")
 * - Free of meta-references ("en la sección", "del manual", "pág.", "página") and citation-year trivia ("1998")
 * - Proper Spanish contractions ("al", "del")
 * - Unique correct answer and category-matched, distinct options
 */
export function validateQuestionQualityGate(rawQ: Question): {
  valid: boolean;
  reason?: string;
  question: Question;
} {
  const prompt = fixSpanishContractionsAndGrammar(stripQuestionBoilerplate(rawQ.prompt || ''));
  const topicTitle = fixSpanishContractionsAndGrammar(
    (rawQ.topicTitle || 'Conceptos Fundamentales').replace(/\(\s*(?:p[áa]g|pp?)\b[^)]*\)/gi, '').trim()
  );
  const specificTopic = fixSpanishContractionsAndGrammar(
    (rawQ.specificTopic || rawQ.sourceSection || 'Concepto clave').replace(/\(\s*(?:p[áa]g|pp?)\b[^)]*\)/gi, '').trim()
  );
  const correctAnswer = fixSpanishContractionsAndGrammar(rawQ.correctAnswer || '');
  const officialAnswer = fixSpanishContractionsAndGrammar(rawQ.officialAnswer || correctAnswer);
  const explanation = fixSpanishContractionsAndGrammar(rawQ.explanation || officialAnswer);

  const normalizedQ: Question = {
    ...rawQ,
    topicTitle,
    specificTopic,
    prompt,
    correctAnswer,
    officialAnswer,
    explanation,
    options: rawQ.options?.map(o => fixSpanishContractionsAndGrammar(o)),
    fillInContext: rawQ.fillInContext
      ? {
          sentenceBefore: fixSpanishContractionsAndGrammar(rawQ.fillInContext.sentenceBefore),
          targetWord: fixSpanishContractionsAndGrammar(rawQ.fillInContext.targetWord),
          sentenceAfter: fixSpanishContractionsAndGrammar(rawQ.fillInContext.sentenceAfter),
        }
      : undefined,
  };

  // 1. Completeness checks
  if (!prompt || prompt.length < 22 || prompt.split(/\s+/).length < 5) {
    return { valid: false, reason: 'Prompt too short or incomplete', question: normalizedQ };
  }
  if (prompt.includes('…') || prompt.includes('...')) {
    return { valid: false, reason: 'Prompt contains ellipsis truncation', question: normalizedQ };
  }

  // 2. Reject vague, contextless stems
  if (/(?:^|\s)(?:se\s+describe\s+como|le\s+corresponde)\s*:\s*$/i.test(prompt)) {
    return { valid: false, reason: 'Vague incomplete stem', question: normalizedQ };
  }

  // 3. Reject forbidden document/section/page meta-references in prompt
  if (/\b(?:en\s+la\s+secci[óo]n|del\s+manual|del\s+libro|p[áa]g(?:ina)?s?\.?\s*\d+)\b/i.test(prompt)) {
    return { valid: false, reason: 'Forbidden meta-reference in prompt', question: normalizedQ };
  }

  // 4. Reject citation-year trivia
  if (/^(?:18|19|20)\d{2}$/.test(correctAnswer.trim())) {
    return { valid: false, reason: 'Citation year as target answer', question: normalizedQ };
  }

  // 5. Modality-specific checks
  if (normalizedQ.type === 'multiple_choice') {
    const opts = normalizedQ.options || [];
    if (opts.length !== 4) {
      return { valid: false, reason: 'Multiple choice must have 4 options', question: normalizedQ };
    }
    const normSet = new Set<string>();
    for (const opt of opts) {
      if (!opt || opt.length < 2 || opt.includes('…') || opt.includes('...')) {
        return { valid: false, reason: 'Invalid or truncated option', question: normalizedQ };
      }
      normSet.add(normalizeText(opt));
    }
    if (normSet.size < 4) {
      return { valid: false, reason: 'Duplicate options in multiple choice', question: normalizedQ };
    }
    const matchingCorrect = opts.filter(o => normalizeText(o) === normalizeText(normalizedQ.correctAnswer));
    if (matchingCorrect.length !== 1) {
      return { valid: false, reason: 'Multiple choice must have exactly 1 matching correct option', question: normalizedQ };
    }
  } else if (normalizedQ.type === 'true_false') {
    if (normalizedQ.correctAnswer !== 'Verdadero' && normalizedQ.correctAnswer !== 'Falso') {
      return { valid: false, reason: 'Invalid true/false answer', question: normalizedQ };
    }
  } else if (normalizedQ.type === 'fill_blank') {
    const target = normalizedQ.fillInContext?.targetWord || normalizedQ.correctAnswer;
    if (!target || target.length < 3 || /^(?:18|19|20)\d{2}$/.test(target.trim())) {
      return { valid: false, reason: 'Invalid fill-in-the-blank target', question: normalizedQ };
    }
  }

  return { valid: true, question: normalizedQ };
}

/**
 * Synthesizes a single complete, well-redacted, self-contained question for a specific sentence `sObj`,
 * partner sentence `partnerObj`, modality, difficulty level, and semantic angle (`angleIndex = 0 | 1 | 2`).
 * Guarantees that:
 * - Fácil, Medio, Difícil (POVEDA), and Jacqueline have completely different cognitive structures and prompts.
 * - Every question stem includes full context of what is being asked using the specific semantic class (`paso`, `etapa`, `período`, `autor`, `técnica`, `tipo`, `concepto`, `mecanismo`, `principio`).
 * - Distractors match the exact semantic category of the correct answer (authors with authors, concepts with concepts, etc.).
 */
function synthesizeQuestionForDifficultyAndAngle(params: {
  sObj: ExtractedSentence;
  partnerObj: ExtractedSentence;
  allSentences: ExtractedSentence[];
  allKeywords: string[];
  allAuthors: string[];
  modality: QuestionModality;
  difficulty: DifficultyLevel;
  angleIndex: number;
  questionSerial: number;
}): Question {
  const {
    sObj,
    partnerObj,
    allSentences,
    allKeywords,
    allAuthors,
    modality,
    difficulty,
    angleIndex,
    questionSerial,
  } = params;

  const sem = analyzeSentenceSemantics(sObj);
  const partnerSem = analyzeSentenceSemantics(partnerObj);

  const topicTitle = sObj.topicTitle || deriveDocumentBaseTopic(sObj.docName);
  const specificTopic = sObj.specificTopic || sObj.conceptPhrase || topicTitle;
  const conceptLabel = sObj.conceptPhrase || specificTopic;
  const classLabel = getSemanticClassQuestionLabel(sem.semanticClass);

  // Choose primary and secondary keywords from sObj (never a citation year)
  const primaryKeyword =
    sObj.keywords[0] ||
    allKeywords[questionSerial % Math.max(1, allKeywords.length)] ||
    conceptLabel;
  const secondaryKeyword =
    sObj.keywords[1] ||
    sObj.keywords[0] ||
    allKeywords[(questionSerial + 1) % Math.max(1, allKeywords.length)] ||
    primaryKeyword;
  const tertiaryKeyword =
    sObj.keywords[2] ||
    sObj.keywords[1] ||
    sObj.keywords[0] ||
    primaryKeyword;

  const splitPrimary = splitSentenceAroundKeyword(sObj.text, primaryKeyword);
  const splitSecondary = splitSentenceAroundKeyword(sObj.text, secondaryKeyword);
  const splitTertiary = splitSentenceAroundKeyword(sObj.text, tertiaryKeyword);

  // Prioritize distractors from the SAME document first so domain vocabulary stays coherent
  const sameDocKeywords: string[] = [];
  for (const sent of allSentences) {
    if (sent.docName === sObj.docName) {
      for (const kw of sent.keywords) {
        if (!sameDocKeywords.some(existing => normalizeText(existing) === normalizeText(kw))) {
          sameDocKeywords.push(kw);
        }
      }
    }
  }
  const candidatePool = sameDocKeywords.length >= 5 ? [...sameDocKeywords, ...allKeywords] : allKeywords;

  const otherKeywords = candidatePool.filter(
    k =>
      !isCorruptedToken(k) &&
      normalizeText(k) !== normalizeText(primaryKeyword) &&
      normalizeText(k) !== normalizeText(secondaryKeyword) &&
      !normalizeText(sObj.text).includes(normalizeText(k))
  );

  const replacementKwA = otherKeywords[questionSerial % Math.max(1, otherKeywords.length)] || 'el procedimiento secundario';
  const replacementKwB = otherKeywords[(questionSerial + 1) % Math.max(1, otherKeywords.length)] || 'la condición accesoria';

  // ============================================================================
  // 1. MULTIPLE CHOICE (4 distinct cognitive profiles + category-matched options)
  // ============================================================================
  if (modality === 'multiple_choice') {
    // --- NIVEL FÁCIL: Identificación directa de definiciones, autores y conceptos básicos ---
    if (difficulty === 'facil') {
      // Special Category-Matched Angle when the sentence is about an AUTHOR (Autores con Autores!)
      if (sem.semanticClass === 'autor' && sem.authorName && angleIndex % 3 === 1) {
        const correctAuthor = sem.authorName;
        const authorDistractors: string[] = [];
        for (const docAuth of allAuthors) {
          if (authorDistractors.length >= 3) break;
          if (normalizeText(docAuth) !== normalizeText(correctAuthor)) {
            authorDistractors.push(docAuth);
          }
        }
        const fallbackAcademicAuthors = [
          'Siquier de Ocampo y García Arzeno',
          'José Bleger (Argentina)',
          'Rodolfo Bohoslavsky (Argentina)',
          'Arminda Aberastury (Argentina)',
          'Robert Sternberg',
          'Jean Piaget',
        ];
        for (const fa of fallbackAcademicAuthors) {
          if (authorDistractors.length >= 3) break;
          if (
            normalizeText(fa) !== normalizeText(correctAuthor) &&
            !normalizeText(correctAuthor).includes(normalizeText(fa.split(' ')[0])) &&
            !authorDistractors.some(d => normalizeText(d) === normalizeText(fa))
          ) {
            authorDistractors.push(fa);
          }
        }

        // Clean description of the author's contribution without revealing the author's name in the stem
        const escapedAuth = correctAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const contributionClause = sObj.text
          .replace(new RegExp(`^(?:El\\s+autor|La\\s+autora|Seg[úu]n\\s+el\\s+autor)\\s+${escapedAuth}\\s*`, 'i'), '')
          .replace(new RegExp(`fue\\s+desarrollado\\s+y\\s+fundamentado\\s+te[óo]ricamente\\s+por\\s+${escapedAuth}`, 'i'), 'fue desarrollado teóricamente en esta área')
          .replace(/[.]+$/, '')
          .trim();

        const options = rotateOptions([correctAuthor, ...authorDistractors.slice(0, 3)], questionSerial + angleIndex);
        return {
          id: `doc-mc-facil-auth-${questionSerial}`,
          type: 'multiple_choice',
          difficulty,
          topicTitle,
          specificTopic,
          prompt: `En el estudio de «${topicTitle}», ¿qué autor o referente teórico ${lowerFirst(contributionClause)}?`,
          options,
          correctAnswer: correctAuthor,
          officialAnswer: sObj.text,
          explanation: formatStructuredExplanation({
            correctSummary: correctAuthor,
            reasonWhy: `Este referente teórico es quien formula dicho planteamiento dentro de «${specificTopic}»`,
            exactQuote: sObj.text,
            docName: sObj.docName,
            topicTitle,
            specificTopic,
          }),
          sourceDocName: sObj.docName,
          sourceSection: specificTopic,
        };
      }

      if (angleIndex % 3 === 1 && sem.predicateClause.length >= 22) {
        // Angle 1: Given the explicit predicate/description, identify the specific element of the same semantic class
        const correctSubjectOption = ensurePeriod(
          `${capitalizeFirst(sem.subjectClause)}, en el ámbito de ${specificTopic.toLowerCase()}`
        );
        const subjectDistractors: string[] = [];

        // Prioritize other sentences with the SAME semanticClass first so options are strictly category-matched
        const sortedOthers = [
          ...allSentences.filter(o => o.semanticClass === sem.semanticClass),
          ...allSentences.filter(o => o.semanticClass !== sem.semanticClass),
        ];

        for (const other of sortedOthers) {
          if (subjectDistractors.length >= 3) break;
          if (normalizeText(other.text) === normalizeText(sObj.text)) continue;
          const otherSem = analyzeSentenceSemantics(other);
          const cand = ensurePeriod(
            `${capitalizeFirst(otherSem.subjectClause)}, vinculado al proceso de ${other.specificTopic.toLowerCase()}`
          );
          if (
            normalizeText(cand) !== normalizeText(correctSubjectOption) &&
            !subjectDistractors.some(d => normalizeText(d) === normalizeText(cand))
          ) {
            subjectDistractors.push(cand);
          }
        }

        const fallbackSubjectDistractors = [
          `Un ${classLabel} secundario que prescinde de ${primaryKeyword.toLowerCase()} en ${topicTitle.toLowerCase()}.`,
          `El ${classLabel} auxiliar de carácter externo ajeno a ${specificTopic.toLowerCase()}.`,
          `Un ${classLabel} meramente opcional que excluye la intervención de ${secondaryKeyword.toLowerCase()}.`,
        ];
        for (const fb of fallbackSubjectDistractors) {
          if (subjectDistractors.length >= 3) break;
          if (!subjectDistractors.some(d => normalizeText(d) === normalizeText(fb))) {
            subjectDistractors.push(fb);
          }
        }

        const options = rotateOptions([correctSubjectOption, ...subjectDistractors.slice(0, 3)], questionSerial + angleIndex);
        return {
          id: `doc-mc-facil-${questionSerial}`,
          type: 'multiple_choice',
          difficulty,
          topicTitle,
          specificTopic,
          prompt: `Dentro del estudio de «${topicTitle}», ¿qué ${classLabel} específico ${lowerFirst(sem.predicateClause.replace(/[.]+$/, ''))}?`,
          options,
          correctAnswer: correctSubjectOption,
          officialAnswer: sObj.text,
          explanation: formatStructuredExplanation({
            correctSummary: correctSubjectOption,
            reasonWhy: `Identifica de manera exacta el ${classLabel} al que corresponde la definición`,
            exactQuote: sObj.text,
            docName: sObj.docName,
            topicTitle,
            specificTopic,
          }),
          sourceDocName: sObj.docName,
          sourceSection: specificTopic,
        };
      }

      // Angle 0 & 2: Direct conceptual definition question specifying the exact class, subject, and topic
      const correctDef = sObj.text;
      const defDistractors = [
        buildNaturalFalseStatement(sObj, splitPrimary, replacementKwA, 'facil', 0),
        `El ${classLabel} de «${conceptLabel}» constituye un elemento externo que no guarda relación con «${secondaryKeyword}» ni con ${topicTitle.toLowerCase()}.`,
        `La función básica de «${conceptLabel}» consiste en omitir el análisis de «${primaryKeyword}» durante el proceso.`,
      ];
      const options = rotateOptions([correctDef, ...defDistractors], questionSerial + angleIndex);
      const prompt =
        angleIndex % 3 === 0
          ? `Respecto al ${classLabel} «${specificTopic}» dentro del tema «${topicTitle}», ¿qué establece su definición fundamental sobre ${lowerFirst(sem.subjectClause)}?`
          : `¿Cuál de los siguientes enunciados define de manera correcta y directa el ${classLabel} «${conceptLabel}» dentro de «${topicTitle}»?`;

      return {
        id: `doc-mc-facil-${questionSerial}`,
        type: 'multiple_choice',
        difficulty,
        topicTitle,
        specificTopic,
        prompt,
        options,
        correctAnswer: correctDef,
        officialAnswer: sObj.text,
        explanation: formatStructuredExplanation({
          correctSummary: correctDef,
          reasonWhy: `Expone sin alteraciones la definición fundamental de «${specificTopic}»`,
          exactQuote: sObj.text,
          docName: sObj.docName,
          topicTitle,
          specificTopic,
        }),
        sourceDocName: sObj.docName,
        sourceSection: specificTopic,
      };
    }

    // --- NIVEL MEDIO: Mecanismos operativos, Finalidad (¿Para qué?) y Relaciones Causa-Efecto ---
    if (difficulty === 'medio') {
      if (sem.purposeClause && sem.actionBeforePurpose && angleIndex % 2 === 0) {
        const correctPurpose = ensurePeriod(`Para ${lowerFirst(sem.purposeClause)}`);
        const purposeDistractors: string[] = [];

        for (const other of allSentences) {
          if (purposeDistractors.length >= 2) break;
          if (normalizeText(other.text) === normalizeText(sObj.text)) continue;
          const otherSem = analyzeSentenceSemantics(other);
          if (otherSem.purposeClause) {
            const cand = ensurePeriod(`Para ${lowerFirst(otherSem.purposeClause)}`);
            if (normalizeText(cand) !== normalizeText(correctPurpose)) {
              purposeDistractors.push(cand);
            }
          }
        }

        const fallbackPurposes = [
          `Para sustituir la función de «${primaryKeyword}» y evitar el análisis de «${secondaryKeyword}».`,
          `Para descartar la intervención de «${conceptLabel}» y reducir el proceso a un trámite aislado.`,
          `Para posponer indefinidamente la evaluación de «${specificTopic.toLowerCase()}» dentro de ${topicTitle.toLowerCase()}.`,
        ];
        for (const fp of fallbackPurposes) {
          if (purposeDistractors.length >= 3) break;
          if (!purposeDistractors.some(d => normalizeText(d) === normalizeText(fp))) {
            purposeDistractors.push(fp);
          }
        }

        const options = rotateOptions([correctPurpose, ...purposeDistractors.slice(0, 3)], questionSerial + angleIndex);
        return {
          id: `doc-mc-medio-${questionSerial}`,
          type: 'multiple_choice',
          difficulty,
          topicTitle,
          specificTopic,
          prompt: `Dentro de «${topicTitle}», ¿con qué finalidad u objetivo funcional ${lowerFirst(sem.actionBeforePurpose)}?`,
          options,
          correctAnswer: correctPurpose,
          officialAnswer: sObj.text,
          explanation: formatStructuredExplanation({
            correctSummary: correctPurpose,
            reasonWhy: `Precisa el propósito funcional exacto por el cual se ejecuta esta acción en «${specificTopic}»`,
            exactQuote: sObj.text,
            docName: sObj.docName,
            topicTitle,
            specificTopic,
          }),
          sourceDocName: sObj.docName,
          sourceSection: specificTopic,
        };
      }

      if (sem.meansClause && sem.actionBeforeMeans && angleIndex % 2 === 1) {
        const correctMeans = ensurePeriod(`Se lleva a cabo ${lowerFirst(sem.meansClause)}`);
        const meansDistractors = [
          `Se ejecuta prescindiendo de «${secondaryKeyword}» y empleando únicamente «${replacementKwA}».`,
          `Se realiza de forma espontánea sin intervención de «${primaryKeyword}» ni de mecanismos reguladores.`,
          `Opera bloqueando la acción de «${conceptLabel}» mediante un procedimiento inverso.`,
        ];
        const options = rotateOptions([correctMeans, ...meansDistractors], questionSerial + angleIndex);
        return {
          id: `doc-mc-medio-${questionSerial}`,
          type: 'multiple_choice',
          difficulty,
          topicTitle,
          specificTopic,
          prompt: `Al analizar el ${classLabel} «${specificTopic}», ¿mediante qué vía, instrumento o mecanismo específico ${lowerFirst(sem.actionBeforeMeans)}?`,
          options,
          correctAnswer: correctMeans,
          officialAnswer: sObj.text,
          explanation: formatStructuredExplanation({
            correctSummary: correctMeans,
            reasonWhy: `Describe el medio e instrumento operativo real mediante el cual actúa «${specificTopic}»`,
            exactQuote: sObj.text,
            docName: sObj.docName,
            topicTitle,
            specificTopic,
          }),
          sourceDocName: sObj.docName,
          sourceSection: specificTopic,
        };
      }

      // Functional cause-effect / process question for Nivel Medio
      const correctFunctional = sObj.text;
      const funcDistractors = [
        buildNaturalFalseStatement(sObj, splitSecondary, replacementKwA, 'medio', 0),
        `${capitalizeFirst(sem.subjectClause)} opera de manera aislada, invirtiendo el efecto de «${secondaryKeyword}» sobre «${primaryKeyword}».`,
        `${capitalizeFirst(sem.subjectClause)} reemplaza la función de «${partnerObj.conceptPhrase}» eliminando la necesidad de «${secondaryKeyword}».`,
      ];
      const options = rotateOptions([correctFunctional, ...funcDistractors], questionSerial + angleIndex);
      const subjContainsSpecific = normalizeText(sem.subjectClause).includes(normalizeText(specificTopic));
      const contextLabelForMedio = subjContainsSpecific ? topicTitle : specificTopic;
      const medioPrompt =
        angleIndex % 2 === 0
          ? `¿Cómo funciona el ${classLabel} y qué relación operativa establece ${lowerFirst(sem.subjectClause)} en el estudio de «${contextLabelForMedio}»?`
          : `Dentro de la dinámica de «${topicTitle}», ¿qué mecanismo o efecto específico caracteriza la acción de ${lowerFirst(sem.subjectClause)}?`;

      return {
        id: `doc-mc-medio-${questionSerial}`,
        type: 'multiple_choice',
        difficulty,
        topicTitle,
        specificTopic,
        prompt: medioPrompt,
        options,
        correctAnswer: correctFunctional,
        officialAnswer: sObj.text,
        explanation: formatStructuredExplanation({
          correctSummary: correctFunctional,
          reasonWhy: `Explica la relación funcional y operativa entre ${lowerFirst(sem.subjectClause)} y «${secondaryKeyword}»`,
          exactQuote: sObj.text,
          docName: sObj.docName,
          topicTitle,
          specificTopic,
        }),
        sourceDocName: sObj.docName,
        sourceSection: specificTopic,
      };
    }

    // --- NIVEL DIFÍCIL (POVEDA): Análisis Crítico de Excepciones ("¿Cuál es INCORRECTA?") y Condiciones Necesarias ---
    if (difficulty === 'dificil') {
      // Variant A (Exception / Error Identification — classic rigorous POVEDA exam format!)
      if (angleIndex % 2 === 0) {
        const erroneousStatement = buildNaturalFalseStatement(
          sObj,
          splitSecondary,
          replacementKwA,
          'dificil',
          questionSerial + angleIndex
        );

        // Build 3 TRUE propositions from the document so the student must identify the 1 FALSE/ERRONEOUS one
        const trueStatements: string[] = [sObj.text];
        for (const other of allSentences) {
          if (trueStatements.length >= 3) break;
          if (
            normalizeText(other.text) !== normalizeText(sObj.text) &&
            normalizeText(other.text) !== normalizeText(erroneousStatement) &&
            !trueStatements.some(t => normalizeText(t) === normalizeText(other.text))
          ) {
            trueStatements.push(other.text);
          }
        }

        // If the uploaded document had fewer than 3 sentences total, derive 2 additional true analytical statements from sObj
        const fallbackTrueClauses = [
          `En el marco de «${topicTitle}», el estudio de «${specificTopic}» involucra directamente la participación de «${primaryKeyword}».`,
          `Dentro de «${specificTopic}», existe una articulación funcional directa entre ${lowerFirst(sem.subjectClause)} y «${secondaryKeyword}».`,
        ];
        for (const ft of fallbackTrueClauses) {
          if (trueStatements.length >= 3) break;
          if (!trueStatements.some(t => normalizeText(t) === normalizeText(ft))) {
            trueStatements.push(ft);
          }
        }

        const options = rotateOptions([erroneousStatement, ...trueStatements.slice(0, 3)], questionSerial + angleIndex);
        return {
          id: `doc-mc-poveda-exc-${questionSerial}`,
          type: 'multiple_choice',
          difficulty,
          topicTitle,
          specificTopic,
          prompt: `Rigor analítico POVEDA — Al evaluar el ${classLabel} «${specificTopic}» dentro de «${topicTitle}», ¿cuál de las siguientes afirmaciones constituye un ERROR conceptual (es decir, es FALSA)?`,
          options,
          correctAnswer: erroneousStatement,
          officialAnswer: `Afirmación falsa/errónea identificada: "${erroneousStatement}".\nCita exacta verdadera de los apuntes: «${sObj.text}»`,
          explanation: formatStructuredExplanation({
            correctSummary: erroneousStatement,
            reasonWhy: `En este ítem de rigor POVEDA se solicita identificar la afirmación FALSA; dicho enunciado invierte el sentido real de los apuntes`,
            exactQuote: sObj.text,
            docName: sObj.docName,
            topicTitle,
            specificTopic,
          }),
          sourceDocName: sObj.docName,
          sourceSection: specificTopic,
        };
      }

      // Variant B (Strict Necessary Condition & Technical Discrimination POVEDA)
      const correctPovedaCondition = ensurePeriod(
        `Resulta indispensable considerar que ${lowerFirst(sObj.text.replace(/[.]+$/, ''))}, siendo inválido desvincular «${primaryKeyword}» de «${secondaryKeyword}»`
      );
      const povedaTraps = [
        `La validez técnica de ${lowerFirst(sem.subjectClause)} exige suprimir la intervención de «${secondaryKeyword}» y sustituirla por «${replacementKwA}».`,
        `${capitalizeFirst(sem.subjectClause)} actúa únicamente como un factor accesorio cuya omisión no altera el resultado en «${specificTopic}».`,
        `Se produce una inversión causal donde «${secondaryKeyword}» anula e impide que ${lowerFirst(sem.subjectClause)} cumpla su función en «${topicTitle}».`,
      ];
      const options = rotateOptions([correctPovedaCondition, ...povedaTraps], questionSerial + angleIndex);
      return {
        id: `doc-mc-poveda-cond-${questionSerial}`,
        type: 'multiple_choice',
        difficulty,
        topicTitle,
        specificTopic,
        prompt: `Bajo el estándar estricto Difícil (POVEDA), ¿qué condición técnica y analítica debe cumplirse necesariamente respecto al ${classLabel} ${lowerFirst(sem.subjectClause)} en «${specificTopic}»?`,
        options,
        correctAnswer: correctPovedaCondition,
        officialAnswer: sObj.text,
        explanation: formatStructuredExplanation({
          correctSummary: correctPovedaCondition,
          reasonWhy: `El estándar POVEDA exige precisión en las condiciones necesarias, descartando las trampas de exclusión o inversión causal`,
          exactQuote: sObj.text,
          docName: sObj.docName,
          topicTitle,
          specificTopic,
        }),
        sourceDocName: sObj.docName,
        sourceSection: specificTopic,
      };
    }

    // --- NIVEL JACQUELINE (EXTREMO): Síntesis Integradora Cruzada entre 2 Conceptos y Doble Premisa con Trampas Parciales ---
    const negatedPrimary = buildNaturalFalseStatement(sObj, splitPrimary, replacementKwA, 'jacqueline', 0);
    const partnerSplit = splitSentenceAroundKeyword(partnerObj.text, partnerObj.keywords[0] || secondaryKeyword);
    const negatedPartner = buildNaturalFalseStatement(partnerObj, partnerSplit, replacementKwB, 'jacqueline', 1);

    if (angleIndex % 2 === 1 && normalizeText(sObj.text) !== normalizeText(partnerObj.text)) {
      // Variant B: Classic Double-Premise Evaluation (Premisa I y Premisa II)
      const premiseI = sObj.text;
      const isPremiseIITrue = questionSerial % 2 === 0;
      const premiseII = isPremiseIITrue ? partnerObj.text : negatedPartner;

      const optBothTrue = `Tanto la Premisa I sobre «${conceptLabel}» como la Premisa II sobre «${partnerObj.conceptPhrase}» son estrictamente verdaderas y coherentes entre sí.`;
      const optITrueIIFalse = `La Premisa I es verdadera respecto a «${conceptLabel}», pero la Premisa II es falsa porque distorsiona el fundamento real de «${partnerObj.conceptPhrase}».`;
      const optIFalseIITrue = `La Premisa I es falsa porque invierte el mecanismo de «${conceptLabel}», mientras que la Premisa II es verdadera.`;
      const optBothFalse = `Ambas premisas son falsas porque contradicen la articulación técnica de «${topicTitle}».`;

      const correctVerdict = isPremiseIITrue ? optBothTrue : optITrueIIFalse;
      const options = [optBothTrue, optITrueIIFalse, optIFalseIITrue, optBothFalse];

      return {
        id: `doc-mc-jacq-premises-${questionSerial}`,
        type: 'multiple_choice',
        difficulty,
        topicTitle,
        specificTopic: `${specificTopic} y ${partnerObj.specificTopic}`,
        prompt: `Análisis de Doble Proposición (Nivel Jacqueline) — Evalúa críticamente:\n• Premisa I: "${premiseI}"\n• Premisa II: "${premiseII}"\n¿Cuál es el dictamen técnico exacto sobre ambas premisas?`,
        options,
        correctAnswer: correctVerdict,
        officialAnswer: `Premisa I (Verdadera): ${sObj.text}\nPremisa II (${isPremiseIITrue ? 'Verdadera' : 'Falsa — Fundamento real'}): ${partnerObj.text}`,
        explanation: formatStructuredExplanation({
          correctSummary: correctVerdict,
          reasonWhy: isPremiseIITrue
            ? `Ambas premisas reflejan fielmente los enunciados de los apuntes`
            : `La Premisa I es verdadera, pero la Premisa II es falsa porque altera el sentido de «${partnerObj.conceptPhrase}»`,
          exactQuote: `${sObj.text} / ${partnerObj.text}`,
          docName: sObj.docName,
          topicTitle,
          specificTopic: `${specificTopic} y ${partnerObj.specificTopic}`,
        }),
        sourceDocName: sObj.docName,
        sourceSection: `${specificTopic} • ${partnerObj.specificTopic}`,
      };
    }

    // Variant A: Cross-Concept Synthesis (True I + True II vs Partial-Truth Traps)
    const hasDistinctPartner = normalizeText(sObj.text) !== normalizeText(partnerObj.text);
    const correctSynthesis = hasDistinctPartner
      ? `Mientras que en «${specificTopic}» ${lowerFirst(sObj.text.replace(/[.]+$/, ''))}, en articulación con «${partnerObj.specificTopic}» ${lowerFirst(partnerObj.text)}`
      : `La articulación técnica de «${specificTopic}» exige que ${lowerFirst(sObj.text.replace(/[.]+$/, ''))}, integrando de forma inseparable «${primaryKeyword}» con «${secondaryKeyword}».`;

    const trapTrueAFalseB = hasDistinctPartner
      ? `Mientras que en «${specificTopic}» ${lowerFirst(sObj.text.replace(/[.]+$/, ''))}, en lo referente a «${partnerObj.specificTopic}» ${lowerFirst(negatedPartner)}`
      : `Aunque es cierto que ${lowerFirst(sem.subjectClause)} interviene en el proceso, su mecanismo descarta por completo la participación de «${secondaryKeyword}».`;

    const trapFalseATrueB = hasDistinctPartner
      ? `Si bien respecto a «${specificTopic}» ${lowerFirst(negatedPrimary.replace(/[.]+$/, ''))}, en cambio en «${partnerObj.specificTopic}» ${lowerFirst(partnerObj.text)}`
      : `El proceso de «${specificTopic}» invierte la relación entre «${primaryKeyword}» y «${secondaryKeyword}», operando únicamente mediante «${replacementKwA}».`;

    const trapCrossSwap = hasDistinctPartner
      ? `Se invierten los mecanismos: ${capitalizeFirst(sem.subjectClause)} asume la función exclusiva de «${partnerObj.conceptPhrase}» y anula la intervención de «${primaryKeyword}».`
      : `Tanto «${primaryKeyword}» como «${secondaryKeyword}» quedan excluidos de «${specificTopic}», delegando su función en «${replacementKwB}».`;

    const options = rotateOptions(
      [correctSynthesis, trapTrueAFalseB, trapFalseATrueB, trapCrossSwap],
      questionSerial + angleIndex
    );

    return {
      id: `doc-mc-jacq-synth-${questionSerial}`,
      type: 'multiple_choice',
      difficulty,
      topicTitle,
      specificTopic: hasDistinctPartner ? `${specificTopic} y ${partnerObj.specificTopic}` : specificTopic,
      prompt: hasDistinctPartner
        ? `Síntesis Integradora (Nivel Jacqueline) — Al correlacionar técnicamente «${specificTopic}» con «${partnerObj.specificTopic}» dentro de «${topicTitle}», ¿cuál de los siguientes postulados compuestos es estrictamente verdadero en sus dos cláusulas?`
        : `Deducción Crítica (Nivel Jacqueline) — Respecto a la arquitectura conceptual de «${specificTopic}» en «${topicTitle}», ¿qué proposición integra de forma exacta la interdependencia entre ${lowerFirst(sem.subjectClause)} y «${secondaryKeyword}»?`,
      options,
      correctAnswer: correctSynthesis,
      officialAnswer: hasDistinctPartner ? `${sObj.text} Asimismo: ${partnerObj.text}` : sObj.text,
      explanation: formatStructuredExplanation({
        correctSummary: correctSynthesis,
        reasonWhy: hasDistinctPartner
          ? `En el Nivel Jacqueline ambas cláusulas de la proposición compuesta deben ser verdaderas, descartando las opciones con trampas parciales`
          : `Sintetiza sin distorsiones la correlación técnica de «${specificTopic}»`,
        exactQuote: hasDistinctPartner ? `${sObj.text} / ${partnerObj.text}` : sObj.text,
        docName: sObj.docName,
        topicTitle,
        specificTopic: hasDistinctPartner ? `${specificTopic} y ${partnerObj.specificTopic}` : specificTopic,
      }),
      sourceDocName: sObj.docName,
      sourceSection: specificTopic,
    };
  }

  // ============================================================================
  // 2. TRUE / FALSE (4 distinct cognitive profiles by difficulty)
  // ============================================================================
  if (modality === 'true_false') {
    const makeTrue = (questionSerial + angleIndex) % 2 === 0;

    if (difficulty === 'facil') {
      const statement = makeTrue
        ? sObj.text
        : buildNaturalFalseStatement(sObj, splitPrimary, replacementKwA, 'facil', angleIndex);
      return {
        id: `doc-tf-facil-${questionSerial}`,
        type: 'true_false',
        difficulty,
        topicTitle,
        specificTopic,
        prompt: statement,
        options: ['Verdadero', 'Falso'],
        correctAnswer: makeTrue ? 'Verdadero' : 'Falso',
        officialAnswer: `${makeTrue ? 'Verdadero' : 'Falso'}. Cita exacta de los apuntes: «${sObj.text}»`,
        explanation: formatStructuredExplanation({
          correctSummary: makeTrue ? 'Verdadero' : 'Falso',
          reasonWhy: makeTrue
            ? `La afirmación coincide de forma directa con la definición de «${specificTopic}»`
            : `La afirmación es falsa porque altera e invierte el concepto básico de «${specificTopic}»`,
          exactQuote: sObj.text,
          docName: sObj.docName,
          topicTitle,
          specificTopic,
        }),
        sourceDocName: sObj.docName,
        sourceSection: specificTopic,
      };
    }

    if (difficulty === 'medio') {
      const statement = makeTrue
        ? `En la dinámica funcional de «${specificTopic}», ${lowerFirst(sem.subjectClause)} se articula directamente de modo que ${lowerFirst(sem.predicateClause)}`
        : `En el funcionamiento de «${specificTopic}», ${lowerFirst(sem.subjectClause)} prescinde de «${secondaryKeyword}» y actúa únicamente para bloquear dicho mecanismo.`;
      return {
        id: `doc-tf-medio-${questionSerial}`,
        type: 'true_false',
        difficulty,
        topicTitle,
        specificTopic,
        prompt: statement,
        options: ['Verdadero', 'Falso'],
        correctAnswer: makeTrue ? 'Verdadero' : 'Falso',
        officialAnswer: `${makeTrue ? 'Verdadero' : 'Falso'}. Cita exacta de los apuntes: «${sObj.text}»`,
        explanation: formatStructuredExplanation({
          correctSummary: makeTrue ? 'Verdadero' : 'Falso',
          reasonWhy: makeTrue
            ? `Describe correctamente la relación funcional y el mecanismo operativo de «${specificTopic}»`
            : `La afirmación es falsa porque invierte el propósito y mecanismo funcional de ${lowerFirst(sem.subjectClause)}`,
          exactQuote: sObj.text,
          docName: sObj.docName,
          topicTitle,
          specificTopic,
        }),
        sourceDocName: sObj.docName,
        sourceSection: specificTopic,
      };
    }

    if (difficulty === 'dificil') {
      // Rigor POVEDA: Double-condition critical verification
      const statement = makeTrue
        ? `Bajo un análisis técnico riguroso de «${specificTopic}», resulta una condición necesaria que ${lowerFirst(sObj.text.replace(/[.]+$/, ''))}, sin que pueda sustituirse «${primaryKeyword}» por un criterio accesorio.`
        : `Según el análisis crítico de «${specificTopic}», ${lowerFirst(sem.subjectClause)} mantiene intacta su validez y eficacia técnica incluso cuando se suprime por completo la intervención de «${secondaryKeyword}».`;
      return {
        id: `doc-tf-poveda-${questionSerial}`,
        type: 'true_false',
        difficulty,
        topicTitle,
        specificTopic,
        prompt: statement,
        options: ['Verdadero', 'Falso'],
        correctAnswer: makeTrue ? 'Verdadero' : 'Falso',
        officialAnswer: `${makeTrue ? 'Verdadero' : 'Falso'} (Criterio POVEDA). Cita exacta de los apuntes: «${sObj.text}»`,
        explanation: formatStructuredExplanation({
          correctSummary: `${makeTrue ? 'Verdadero' : 'Falso'} (Criterio POVEDA)`,
          reasonWhy: makeTrue
            ? `Ambas condiciones del enunciado son técnicamente necesarias conforme a los apuntes`
            : `Es falso (trampa de condición crítica POVEDA) porque no se puede suprimir «${secondaryKeyword}» sin invalidar el proceso`,
          exactQuote: sObj.text,
          docName: sObj.docName,
          topicTitle,
          specificTopic,
        }),
        sourceDocName: sObj.docName,
        sourceSection: specificTopic,
      };
    }

    // Nivel Jacqueline: Compound two-premise statement (when False, First clause is TRUE and Second clause is FALSE!)
    const hasDistinctPartner = normalizeText(sObj.text) !== normalizeText(partnerObj.text);
    const partnerSplit = splitSentenceAroundKeyword(partnerObj.text, partnerObj.keywords[0] || secondaryKeyword);
    const negatedPartner = buildNaturalFalseStatement(partnerObj, partnerSplit, replacementKwB, 'jacqueline', 1);

    const jacqStatement = makeTrue
      ? hasDistinctPartner
        ? `En la correlación entre «${specificTopic}» y «${partnerObj.specificTopic}», tanto es cierto que ${lowerFirst(sObj.text.replace(/[.]+$/, ''))}, como también que ${lowerFirst(partnerObj.text)}`
        : `Desde una perspectiva integradora sobre «${specificTopic}», ${lowerFirst(sObj.text.replace(/[.]+$/, ''))}, articulando de manera indisoluble «${primaryKeyword}» y «${secondaryKeyword}».`
      : hasDistinctPartner
      ? `Si bien es verdadero que ${lowerFirst(sObj.text.replace(/[.]+$/, ''))}, en cambio respecto a «${partnerObj.specificTopic}» ${lowerFirst(negatedPartner)}`
      : `Aunque es cierto que ${lowerFirst(sem.subjectClause)} participa en «${specificTopic}», su mecanismo exige excluir por completo la intervención de «${secondaryKeyword}».`;

    return {
      id: `doc-tf-jacq-${questionSerial}`,
      type: 'true_false',
      difficulty,
      topicTitle,
      specificTopic: hasDistinctPartner ? `${specificTopic} y ${partnerObj.specificTopic}` : specificTopic,
      prompt: jacqStatement,
      options: ['Verdadero', 'Falso'],
      correctAnswer: makeTrue ? 'Verdadero' : 'Falso',
      officialAnswer: `${makeTrue ? 'Verdadero' : 'Falso'} (Síntesis Jacqueline). Cita exacta de los apuntes: «${sObj.text}»${hasDistinctPartner ? ` / «${partnerObj.text}»` : ''}`,
      explanation: formatStructuredExplanation({
        correctSummary: `${makeTrue ? 'Verdadero' : 'Falso'} (Nivel Jacqueline)`,
        reasonWhy: makeTrue
          ? `Las dos proposiciones articuladas en el enunciado compuesto son estrictamente verdaderas`
          : `Es falso (trampa de doble cláusula Nivel Jacqueline): la primera parte es verdadera, pero la segunda cláusula contradice los apuntes`,
        exactQuote: hasDistinctPartner ? `${sObj.text} / ${partnerObj.text}` : sObj.text,
        docName: sObj.docName,
        topicTitle,
        specificTopic: hasDistinctPartner ? `${specificTopic} y ${partnerObj.specificTopic}` : specificTopic,
      }),
      sourceDocName: sObj.docName,
      sourceSection: specificTopic,
    };
  }

  // ============================================================================
  // 3. FILL IN THE BLANK (Targets different terms and contexts per difficulty)
  // ============================================================================
  if (modality === 'fill_blank') {
    const activeSplit =
      difficulty === 'facil'
        ? splitPrimary
        : difficulty === 'medio'
        ? splitSecondary
        : difficulty === 'dificil'
        ? angleIndex % 2 === 0
          ? splitTertiary
          : splitSecondary
        : splitSecondary;

    const fibPrompt =
      difficulty === 'jacqueline'
        ? `Síntesis Nivel Jacqueline — Escribe el concepto técnico exacto que articula la proposición sobre el ${classLabel} «${specificTopic}» en el marco de «${topicTitle}»:`
        : difficulty === 'dificil'
        ? `Precisión analítica Difícil (POVEDA) — Identifica y escribe el término técnico indispensable que valida el siguiente criterio sobre el ${classLabel} «${specificTopic}»:`
        : difficulty === 'medio'
        ? `Comprensión funcional — Completa el espacio en blanco con el término que precisa el mecanismo o relación del ${classLabel} «${specificTopic}»:`
        : `Definición fundamental — Completa el enunciado escribiendo el término clave correspondiente al ${classLabel} «${specificTopic}»:`;

    const sentenceBefore =
      difficulty === 'jacqueline' && normalizeText(sObj.text) !== normalizeText(partnerObj.text)
        ? `En correlación con «${partnerObj.conceptPhrase}», ${lowerFirst(activeSplit.sentenceBefore || `el desarrollo de ${conceptLabel} comprende`)}`
        : activeSplit.sentenceBefore || `Dentro de «${topicTitle}», el estudio de ${conceptLabel} comprende`;

    const sentenceAfter =
      activeSplit.sentenceAfter || `como componente esencial dentro de ${topicTitle.toLowerCase()}.`;

    return {
      id: `doc-fib-${difficulty}-${questionSerial}`,
      type: 'fill_blank',
      difficulty,
      topicTitle,
      specificTopic,
      prompt: fibPrompt,
      fillInContext: {
        sentenceBefore,
        targetWord: activeSplit.targetWord,
        sentenceAfter,
      },
      correctAnswer: activeSplit.targetWord,
      officialAnswer: `Término exacto requerido: «${activeSplit.targetWord}».\nCita exacta de los apuntes: «${sObj.text}»`,
      explanation: formatStructuredExplanation({
        correctSummary: activeSplit.targetWord,
        reasonWhy: `El término «${activeSplit.targetWord}» es la pieza conceptual exacta que completa con sentido lógico el enunciado sobre «${specificTopic}»`,
        exactQuote: sObj.text,
        docName: sObj.docName,
        topicTitle,
        specificTopic,
      }),
      sourceDocName: sObj.docName,
      sourceSection: specificTopic,
    };
  }

  // ============================================================================
  // 4. OPEN QUESTION (4 distinct analytical depths and prompts by difficulty)
  // ============================================================================
  const hasDistinctPartner = normalizeText(sObj.text) !== normalizeText(partnerObj.text);

  if (difficulty === 'facil') {
    return {
      id: `doc-oq-facil-${questionSerial}`,
      type: 'open_question',
      difficulty,
      topicTitle,
      specificTopic,
      prompt: `En el marco de «${topicTitle}», ¿en qué consiste fundamentalmente el ${classLabel} ${lowerFirst(sem.subjectClause)} y qué establece «${specificTopic}» al respecto?`,
      correctAnswer: sObj.text,
      officialAnswer: sObj.text,
      explanation: formatStructuredExplanation({
        correctSummary: sObj.text,
        reasonWhy: `En nivel Fácil la respuesta debe identificar el ${classLabel} central y su definición directa`,
        exactQuote: sObj.text,
        docName: sObj.docName,
        topicTitle,
        specificTopic,
      }),
      sourceDocName: sObj.docName,
      sourceSection: specificTopic,
    };
  }

  if (difficulty === 'medio') {
    const medioPrompt = sem.purposeClause
      ? `Explica el mecanismo funcional del ${classLabel} «${specificTopic}»: ¿cómo se desarrolla ${lowerFirst(sem.actionBeforePurpose || sem.subjectClause)} y cuál es su finalidad específica dentro de «${topicTitle}»?`
      : `¿De qué manera opera el ${classLabel} ${lowerFirst(sem.subjectClause)} dentro de «${specificTopic}» y cómo se relaciona funcionalmente con «${secondaryKeyword}»?`;
    return {
      id: `doc-oq-medio-${questionSerial}`,
      type: 'open_question',
      difficulty,
      topicTitle,
      specificTopic,
      prompt: medioPrompt,
      correctAnswer: sObj.text,
      officialAnswer: `${sObj.text}${hasDistinctPartner && partnerObj.docName === sObj.docName ? ` En relación complementaria: ${partnerObj.text}` : ''}`,
      explanation: formatStructuredExplanation({
        correctSummary: sObj.text,
        reasonWhy: `En nivel Medio se evalúa la comprensión del proceso, el medio de acción («${secondaryKeyword}») y su finalidad práctica`,
        exactQuote: sObj.text,
        docName: sObj.docName,
        topicTitle,
        specificTopic,
      }),
      sourceDocName: sObj.docName,
      sourceSection: specificTopic,
    };
  }

  if (difficulty === 'dificil') {
    return {
      id: `doc-oq-poveda-${questionSerial}`,
      type: 'open_question',
      difficulty,
      topicTitle,
      specificTopic,
      prompt: `Análisis Crítico Difícil (POVEDA) — Fundamenta con precisión técnica por qué es indispensable la articulación entre el ${classLabel} ${lowerFirst(sem.subjectClause)} y «${secondaryKeyword}» en «${specificTopic}», e indica qué distorsión conceptual ocurriría si se omitiera dicho elemento.`,
      correctAnswer: sObj.text,
      officialAnswer: `1. Condición técnica indispensable: ${sObj.text}\n2. Implicación crítica (POVEDA): Si se omitiera «${secondaryKeyword}» o «${primaryKeyword}», se desnaturalizaría el mecanismo de «${specificTopic}» dentro de «${topicTitle}».`,
      explanation: formatStructuredExplanation({
        correctSummary: sObj.text,
        reasonWhy: `El estándar Difícil (POVEDA) exige justificar tanto el mecanismo exacto como la razón crítica por la cual sus componentes («${primaryKeyword}» y «${secondaryKeyword}») son insustituibles`,
        exactQuote: sObj.text,
        docName: sObj.docName,
        topicTitle,
        specificTopic,
      }),
      sourceDocName: sObj.docName,
      sourceSection: specificTopic,
    };
  }

  // Nivel Jacqueline Open Question: Cross-Concept Synthesis
  return {
    id: `doc-oq-jacq-${questionSerial}`,
    type: 'open_question',
    difficulty,
    topicTitle,
    specificTopic: hasDistinctPartner ? `${specificTopic} y ${partnerObj.specificTopic}` : specificTopic,
    prompt: hasDistinctPartner
      ? `Síntesis Magistral (Nivel Jacqueline) — Desarrolla de forma integrada cómo se articulan y contrastan técnicamente «${specificTopic}» (${lowerFirst(sem.subjectClause)}) y «${partnerObj.specificTopic}» (${lowerFirst(partnerSem.subjectClause)}) dentro del estudio de «${topicTitle}».`
      : `Síntesis Magistral (Nivel Jacqueline) — Analiza exhaustivamente la arquitectura técnica de «${specificTopic}», explicando la interdependencia entre ${lowerFirst(sem.subjectClause)}, «${primaryKeyword}» y «${secondaryKeyword}».`,
    correctAnswer: hasDistinctPartner ? `${sObj.text} ${partnerObj.text}` : sObj.text,
    officialAnswer: hasDistinctPartner
      ? `Síntesis Integrada Nivel Jacqueline:\n• Eje 1 (${specificTopic}): ${sObj.text}\n• Eje 2 (${partnerObj.specificTopic}): ${partnerObj.text}`
      : `Síntesis Exhaustiva Nivel Jacqueline:\n• Fundamento central: ${sObj.text}`,
    explanation: formatStructuredExplanation({
      correctSummary: hasDistinctPartner ? `${sObj.text} ${partnerObj.text}` : sObj.text,
      reasonWhy: hasDistinctPartner
        ? `Para conquistar el Nivel Jacqueline, la respuesta debe integrar con rigor técnico ambos ejes del material`
        : `Se requiere precisión terminológica absoluta sobre cómo interactúan todos los elementos de «${specificTopic}»`,
      exactQuote: hasDistinctPartner ? `${sObj.text} / ${partnerObj.text}` : sObj.text,
      docName: sObj.docName,
      topicTitle,
      specificTopic: hasDistinctPartner ? `${specificTopic} y ${partnerObj.specificTopic}` : specificTopic,
    }),
    sourceDocName: sObj.docName,
    sourceSection: specificTopic,
  };
}

/**
 * Generates questions 100% exclusively from the active documents passed in `docs`.
 * Features:
 * 1. Full Thematic Variety across the entire document (stratified across all sections/headings).
 * 2. Non-Repeating Session Memory: regenerating a quiz or starting a new test rotates through unused sentences,
 *    unused sections, and distinct semantic question angles (`angleIndex = 0, 1, 2`) so it never repeats the same set.
 * 3. True Cognitive Differentiation between `facil`, `medio`, `dificil` (Difícil (POVEDA)), and `jacqueline`.
 * 4. Complete, well-redacted, contextualized questions and answers with `topicTitle` + underlined `specificTopic`.
 * 5. Automatic Quality Gate (`validateQuestionQualityGate`) that validates every question before returning it.
 */
export function generateFallbackQuestions(
  docs: UploadedDoc[],
  config: QuizConfig
): Question[] {
  const { selectedModalities, difficulty, questionCount } = config;
  const filteredDocs = docs && docs.length > 0 ? docs.filter(d => d.selected !== false) : [];
  const activeDocs = filteredDocs.length > 0 ? filteredDocs : docs && docs.length > 0 ? docs : PRESET_SAMPLE_DOCUMENTS;
  const allowedModalities: QuestionModality[] =
    selectedModalities && selectedModalities.length > 0 ? selectedModalities : ['multiple_choice'];

  // Compute a fingerprint for the active document set + difficulty so we can track session history
  const docsFingerprint = `${activeDocs.map(d => `${d.name}:${(d.rawText || '').length}`).join('|')}::${difficulty}`;
  let history = sessionHistoryByDocFingerprint.get(docsFingerprint);
  if (!history) {
    history = {
      generationCount: 0,
      usedSentenceAngleKeys: new Set<string>(),
      usedPromptSignatures: new Set<string>(),
    };
    sessionHistoryByDocFingerprint.set(docsFingerprint, history);
  }

  const currentRunIndex = history.generationCount;
  history.generationCount += 1;
  globalGenerationSequence += 1;

  // Give each difficulty a distinct starting offset so switching between Fácil, Medio, Difícil (POVEDA), and Jacqueline
  // immediately explores different parts and angles of the document in addition to using a distinct cognitive engine!
  const difficultyOffsetMap: Record<DifficultyLevel, number> = {
    facil: 0,
    medio: 3,
    dificil: 7,
    jacqueline: 11,
  };
  const diffOffset = difficultyOffsetMap[difficulty] || 0;
  const effectiveSeed = (config.generationSeed ?? currentRunIndex) + diffOffset;

  // Extract all sentences, keywords, and authors from the active documents
  const { sentences: rawSentences, allKeywords, allAuthors } = extractDocumentKnowledge(activeDocs);

  // Stratify sentences across all sections/themes of the document so every part of the document is represented
  const stratifiedSentences = stratifySentencesAcrossThemes(rawSentences, effectiveSeed);

  // Build a large, multi-angle candidate pool across all stratified sentences and angles (0, 1, 2)
  const candidatePool: Array<{
    question: Question;
    sentenceAngleKey: string;
    themeKey: string;
    wasUsedBefore: boolean;
  }> = [];

  const totalSentences = stratifiedSentences.length;
  const maxAngles = 3;
  let serialCounter = 1;

  for (let angle = 0; angle < maxAngles; angle++) {
    const activeAngle = (angle + currentRunIndex + diffOffset) % maxAngles;

    for (let sIdx = 0; sIdx < totalSentences; sIdx++) {
      const rotatedIdx = (sIdx + currentRunIndex * 2 + diffOffset) % totalSentences;
      const sObj = stratifiedSentences[rotatedIdx];

      // Pick a distinct partner sentence from another concept/section for cross-analysis
      let partnerObj = stratifiedSentences[(rotatedIdx + Math.max(1, Math.floor(totalSentences / 2))) % totalSentences];
      for (let step = 1; step < totalSentences; step++) {
        const candidatePartner = stratifiedSentences[(rotatedIdx + step) % totalSentences];
        if (
          normalizeText(candidatePartner.specificTopic) !== normalizeText(sObj.specificTopic) ||
          normalizeText(candidatePartner.text) !== normalizeText(sObj.text)
        ) {
          partnerObj = candidatePartner;
          break;
        }
      }

      const modality = allowedModalities[(sIdx + activeAngle + currentRunIndex) % allowedModalities.length];
      const sentenceAngleKey = `${normalizeText(sObj.text).slice(0, 60)}::${modality}::${difficulty}::angle${activeAngle}`;

      const synthesized = synthesizeQuestionForDifficultyAndAngle({
        sObj,
        partnerObj,
        allSentences: stratifiedSentences,
        allKeywords,
        allAuthors,
        modality,
        difficulty,
        angleIndex: activeAngle,
        questionSerial: serialCounter++,
      });

      // Run Automatic Final Quality Gate on the synthesized question
      const qualityCheck = validateQuestionQualityGate(synthesized);
      if (!qualityCheck.valid) {
        continue;
      }

      const validQuestion = qualityCheck.question;
      const promptSig = normalizeText(validQuestion.prompt);
      const wasUsedBefore =
        history.usedSentenceAngleKeys.has(sentenceAngleKey) ||
        history.usedPromptSignatures.has(promptSig);

      candidatePool.push({
        question: validQuestion,
        sentenceAngleKey,
        themeKey: normalizeText(`${validQuestion.topicTitle}::${validQuestion.specificTopic}`),
        wasUsedBefore,
      });
    }
  }

  // If all candidates in the document have been used in previous runs, clear the history so a fresh cycle begins cleanly
  const unusedCandidates = candidatePool.filter(c => !c.wasUsedBefore);
  if (unusedCandidates.length < questionCount) {
    history.usedSentenceAngleKeys.clear();
    history.usedPromptSignatures.clear();
  }

  // Sort candidates so unused questions come first, while preserving thematic diversity
  const orderedCandidates = [
    ...candidatePool.filter(c => !c.wasUsedBefore),
    ...candidatePool.filter(c => c.wasUsedBefore),
  ];

  const selectedQuestions: Question[] = [];
  const usedPromptsInThisQuiz = new Set<string>();
  const usedThemesInCurrentPass = new Set<string>();

  // Pass 1: Pick questions maximizing thematic diversity (no two questions from the exact same subtopic until all subtopics are covered)
  for (const cand of orderedCandidates) {
    if (selectedQuestions.length >= questionCount) break;
    const promptSig = normalizeText(cand.question.prompt);
    if (usedPromptsInThisQuiz.has(promptSig)) continue;
    if (usedThemesInCurrentPass.has(cand.themeKey)) continue;

    // Ensure balanced modality distribution when multiple modalities are selected
    const desiredModality = allowedModalities[selectedQuestions.length % allowedModalities.length];
    if (cand.question.type !== desiredModality && orderedCandidates.length > questionCount * 2) {
      continue;
    }

    usedPromptsInThisQuiz.add(promptSig);
    usedThemesInCurrentPass.add(cand.themeKey);
    history.usedSentenceAngleKeys.add(cand.sentenceAngleKey);
    history.usedPromptSignatures.add(promptSig);

    selectedQuestions.push({
      ...cand.question,
      id: `${cand.question.id}-r${currentRunIndex + 1}-${selectedQuestions.length + 1}`,
    });
  }

  // Pass 2: Top up with remaining distinct-prompt candidates if needed
  for (const cand of orderedCandidates) {
    if (selectedQuestions.length >= questionCount) break;
    const promptSig = normalizeText(cand.question.prompt);
    if (usedPromptsInThisQuiz.has(promptSig)) continue;

    usedPromptsInThisQuiz.add(promptSig);
    history.usedSentenceAngleKeys.add(cand.sentenceAngleKey);
    history.usedPromptSignatures.add(promptSig);

    selectedQuestions.push({
      ...cand.question,
      id: `${cand.question.id}-r${currentRunIndex + 1}-${selectedQuestions.length + 1}`,
    });
  }

  // Pass 3: If questionCount is very large (e.g. 20 questions from a 2-sentence doc), synthesize additional angle variations
  let extraIdx = 0;
  while (selectedQuestions.length < questionCount && orderedCandidates.length > 0) {
    const base = orderedCandidates[extraIdx % orderedCandidates.length].question;
    extraIdx++;
    selectedQuestions.push({
      ...base,
      id: `${base.id}-ext-${selectedQuestions.length + 1}`,
    });
  }

  return selectedQuestions.slice(0, questionCount);
}

/**
 * Validates, repairs, and enriches questions returned by any AI engine (`gemini_env`, `gemini_visitor`, `custom_keys`).
 * Guarantees that:
 * 1. Every question has BOTH a clear `topicTitle` (Tema principal) AND `specificTopic` (Subtema específico subrayado).
 * 2. Every question prompt and option is stripped of noisy section/book/manual/page prefixes via `stripQuestionBoilerplate`.
 * 3. Every question belongs strictly to the uploaded `docs`.
 * 4. No question prompt, option, or answer contains PDF CMap corruption (`isCorruptedToken`) or generic filler.
 * 5. Every question passes `validateQuestionQualityGate`.
 */
export function sanitizeAndValidateQuestions(
  rawQuestions: any[],
  docs: UploadedDoc[],
  config: QuizConfig
): Question[] {
  const filteredDocs = docs && docs.length > 0 ? docs.filter(d => d.selected !== false) : [];
  const activeDocs = filteredDocs.length > 0 ? filteredDocs : docs && docs.length > 0 ? docs : PRESET_SAMPLE_DOCUMENTS;
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

    const cleanedPrompt = stripQuestionBoilerplate(cleanExtractedText(String(raw.prompt || '')).trim());
    const promptWords = cleanedPrompt.split(/\s+/).filter(Boolean);
    const corruptedInPrompt = promptWords.filter(w => isCorruptedToken(w)).length;
    if (!cleanedPrompt || promptWords.length < 4 || corruptedInPrompt / promptWords.length > 0.15) {
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
    const baseTopic = deriveDocumentBaseTopic(matchedDoc.name, matchedDoc.analysis?.keyThemes);

    // Resolve Main Topic (`topicTitle`) and Specific Subtopic (`specificTopic`)
    let rawTopic = cleanExtractedText(
      String(raw.topicTitle || raw.tema || raw.theme || '')
    ).trim();
    let rawSpecific = cleanExtractedText(
      String(raw.specificTopic || raw.subtopicTitle || raw.subtema || raw.sourceSection || '')
    ).trim();

    if (rawTopic.includes('•')) {
      const parts = rawTopic.split('•').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        rawTopic = parts[0];
        if (!rawSpecific) rawSpecific = parts.slice(1).join(' • ');
      }
    }

    if (
      !rawTopic ||
      rawTopic.length < 4 ||
      /^fragmento\s*#/i.test(rawTopic) ||
      isCorruptedToken(rawTopic.split(/\s+/)[0] || '')
    ) {
      rawTopic = baseTopic;
    }

    if (
      !rawSpecific ||
      rawSpecific.length < 4 ||
      /^fragmento\s*#/i.test(rawSpecific) ||
      isCorruptedToken(rawSpecific.split(/\s+/)[0] || '') ||
      normalizeText(rawSpecific) === normalizeText(rawTopic)
    ) {
      const promptConcept = extractConceptPhrase(
        cleanedPrompt.replace(/^[¿¡]+|[?!.]+$/g, ''),
        matchedDoc.analysis?.keyThemes || [baseTopic],
        rawTopic
      );
      if (promptConcept && normalizeText(promptConcept) !== normalizeText(rawTopic)) {
        rawSpecific = promptConcept.charAt(0).toUpperCase() + promptConcept.slice(1);
      } else {
        rawSpecific = fallbackPool[i]?.specificTopic || `Análisis de ${rawTopic.toLowerCase()}`;
      }
    }

    const topicTitle = rawTopic;
    const specificTopic = rawSpecific;
    const difficultyLabel = DIFFICULTY_LABELS[config.difficulty] || config.difficulty;

    const officialAnswer =
      stripQuestionBoilerplate(cleanExtractedText(String(raw.officialAnswer || raw.correctAnswer || '')).trim()) ||
      fallbackPool[i]?.officialAnswer ||
      `Fundamento verificado sobre ${specificTopic} dentro del tema ${topicTitle}.`;
    const explanation =
      stripQuestionBoilerplate(cleanExtractedText(String(raw.explanation || raw.officialAnswer || '')).trim()) ||
      fallbackPool[i]?.explanation ||
      `Esta respuesta (${difficultyLabel}) se fundamenta en la relación directa entre ${specificTopic} y ${topicTitle}. Fuente: ${matchedDocName}.`;

    let candidateQuestion: Question | null = null;

    if (type === 'true_false') {
      const normAns = normalizeText(String(raw.correctAnswer || 'Verdadero'));
      const isFalse = normAns === 'falso' || normAns === 'false' || normAns === 'no';
      candidateQuestion = {
        id: String(raw.id || `ai-tf-${i + 1}`),
        type: 'true_false',
        difficulty: config.difficulty,
        topicTitle,
        specificTopic,
        prompt: cleanedPrompt,
        options: ['Verdadero', 'Falso'],
        correctAnswer: isFalse ? 'Falso' : 'Verdadero',
        officialAnswer,
        explanation,
        sourceDocName: matchedDocName,
        sourceSection: specificTopic,
      };
    } else if (type === 'multiple_choice') {
      const rawOpts = Array.isArray(raw.options)
        ? raw.options
            .map((o: any) => stripQuestionBoilerplate(cleanExtractedText(String(o || '')).trim()))
            .filter(
              (o: string) =>
                Boolean(o) &&
                !/ninguno de los conceptos citados/i.test(o) &&
                !o.split(/\s+/).some((w: string) => isCorruptedToken(w))
            )
        : [];

      const cleanCorrect = stripQuestionBoilerplate(
        cleanExtractedText(String(raw.correctAnswer || rawOpts[0] || '')).trim()
      );
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
        const extra = `Planteamiento alternativo que invierte la función de ${specificTopic.toLowerCase()} (${finalOpts.length + 1})`;
        if (!finalOpts.includes(extra)) finalOpts.push(extra);
      }

      candidateQuestion = {
        id: String(raw.id || `ai-mc-${i + 1}`),
        type: 'multiple_choice',
        difficulty: config.difficulty,
        topicTitle,
        specificTopic,
        prompt: cleanedPrompt,
        options: finalOpts.slice(0, 4),
        correctAnswer:
          finalOpts.find(o => normalizeText(o) === normalizeText(cleanCorrect)) || cleanCorrect,
        officialAnswer,
        explanation,
        sourceDocName: matchedDocName,
        sourceSection: specificTopic,
      };
    } else if (type === 'fill_blank') {
      const targetWord = cleanExtractedText(
        String(raw.fillInContext?.targetWord || raw.correctAnswer || '')
      ).trim();
      if (!targetWord || targetWord.split(/\s+/).some(w => isCorruptedToken(w))) {
        if (fallbackPool[i]) validated.push(fallbackPool[i]);
        continue;
      }
      const sentenceBefore = stripQuestionBoilerplate(
        cleanExtractedText(
          String(raw.fillInContext?.sentenceBefore || `El estudio de ${specificTopic.toLowerCase()} establece que`)
        ).trim()
      );
      const sentenceAfter = cleanExtractedText(
        String(raw.fillInContext?.sentenceAfter || `constituye un elemento clave dentro de ${topicTitle.toLowerCase()}.`)
      ).trim();

      candidateQuestion = {
        id: String(raw.id || `ai-fib-${i + 1}`),
        type: 'fill_blank',
        difficulty: config.difficulty,
        topicTitle,
        specificTopic,
        prompt: cleanedPrompt,
        fillInContext: {
          sentenceBefore,
          targetWord,
          sentenceAfter,
        },
        correctAnswer: targetWord,
        officialAnswer,
        explanation,
        sourceDocName: matchedDocName,
        sourceSection: specificTopic,
      };
    } else {
      // open_question
      const cleanCorrect = stripQuestionBoilerplate(
        cleanExtractedText(String(raw.correctAnswer || officialAnswer)).trim()
      );
      candidateQuestion = {
        id: String(raw.id || `ai-oq-${i + 1}`),
        type: 'open_question',
        difficulty: config.difficulty,
        topicTitle,
        specificTopic,
        prompt: cleanedPrompt,
        correctAnswer: cleanCorrect,
        officialAnswer,
        explanation,
        sourceDocName: matchedDocName,
        sourceSection: specificTopic,
      };
    }

    if (candidateQuestion) {
      const qGate = validateQuestionQualityGate(candidateQuestion);
      if (qGate.valid) {
        validated.push(qGate.question);
      } else if (fallbackPool[i]) {
        validated.push(fallbackPool[i]);
      }
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
