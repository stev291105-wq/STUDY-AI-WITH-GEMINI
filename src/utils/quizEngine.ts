import type { DifficultyLevel, Question, QuestionModality, QuizConfig, QuizSummary, UploadedDoc, UserAnswer } from '../types.ts';

/**
 * Validates and updates modality selection enforcing the max 3 modes rule.
 */
export function toggleModalitySelection(
  current: QuestionModality[],
  target: QuestionModality
): { updated: QuestionModality[]; canAddMore: boolean; isBlocked: boolean } {
  const exists = current.includes(target);

  if (exists) {
    // If it's the last selected one, don't allow unchecking (must have at least 1)
    if (current.length === 1) {
      return { updated: current, canAddMore: true, isBlocked: false };
    }
    const updated = current.filter(m => m !== target);
    return { updated, canAddMore: updated.length < 3, isBlocked: false };
  } else {
    // Attempting to add
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
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?¿¡!]/g, '')
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
  // Jacqueline Master badge awarded if difficulty was Jacqueline and score >= 80%
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
 * Built-in seed documents with OCR, handwriting and diagram contexts
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

/**
 * High-fidelity fallback / offline generator for quizzes across all requested modes and difficulty levels
 */
export function generateFallbackQuestions(
  docs: UploadedDoc[],
  config: QuizConfig
): Question[] {
  const { selectedModalities, difficulty, questionCount } = config;
  const isJacqueline = difficulty === 'jacqueline';

  // Bank of crafted questions based on the active docs
  const masterPool: Question[] = [
    // Multiple Choice
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
      officialAnswer: 'El Complejo II (succinato deshidrogenasa) transfiere electrones desde el FADH2 hacia la ubiquinona (coenzima Q) a través de centros hierro-azufre sin un cambio suficiente de energía libre para activar translocación de protones a través de la membrana interna.',
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
      officialAnswer: 'El factor 1/sqrt(d_k) contrae la escala del producto punto Q*K^T cuando d_k es grande, evitando saturación de la función softmax donde las derivadas son casi nulas (vanishing gradient problem).',
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
        'Caso Velásquez Rodríguez vs. Honduras (1988)',
        'Caso Barrios Altos vs. Perú (2001)'
      ],
      correctAnswer: 'Caso Almonacid Arellano vs. Chile (2006)',
      officialAnswer: 'El Caso Almonacid Arellano vs. Chile (2006) estableció de manera explícita por primera vez que el Poder Judicial debe ejercer un control de convencionalidad ex officio entre las normas internas y la Convención Americana sobre Derechos Humanos.',
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
      officialAnswer: 'Por cada 6 moléculas de G3P formadas en la fase de reducción, 5 se destinan al reciclaje y regeneración de 3 moléculas de Ribulosa-1,5-bisfosfato (RuBP) consumiendo 3 ATP, dejando una ganancia neta de 1 G3P.',
      explanation: 'Confirmado en la Fase 3 del diagrama: 5 de cada 6 G3P se reciclan estequiométricamente.',
      sourceDocName: 'Infografia_Canva_Ciclo_Calvin_Fotosintesis.png',
      sourceSection: 'Fase 3: Regeneración del aceptor RuBP'
    },

    // True or False
    {
      id: 'q-tf-1',
      type: 'true_false',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
      prompt: isJacqueline
        ? 'Bajo el principio pro homine y la jurisprudencia de la Corte IDH, los jueces nacionales sólo están obligados a ejercer control de convencionalidad si una de las partes en litigio lo solicita expresamente.'
        : 'El control de convencionalidad debe ser ejercido de oficio ("ex officio") por los jueces nacionales, incluso sin petición expresa de las partes.',
      options: ['Verdadero', 'Falso'],
      correctAnswer: isJacqueline ? 'Falso' : 'Verdadero',
      officialAnswer: 'El control de convencionalidad es un deber "ex officio" del Poder Judicial. Los magistrados tienen la obligación jurídica de contrastar la normativa nacional con la CADH aun cuando ninguna parte procesal lo haya peticionado expresamente.',
      explanation: 'El Caso Almonacid Arellano resolvió que los jueces deben ejercer dicho control ex officio en el marco de sus respectivas competencias y regulaciones procesales.',
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
      officialAnswer: 'Verdadero. La ATP Sintasa opera biomecánicamente como una turbina molecular giratoria impulsada por el flujo de protones a favor de su gradiente electroquímico.',
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
      officialAnswer: 'Falso. Al no poseer recurrencia temporal como las RNNs, la operación de atención es equivariante a las permutaciones; por tanto, los Positional Encodings (o RoPE) son estrictamente indispensables para inyectar orden secuencial.',
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
      officialAnswer: 'Falso. La actividad oxigenasa de RuBisCO desencadena fotorrespiración (Ciclo C2), un proceso metabólicamente disipativo que consume ATP y reduce la fijación de carbono hasta un 25%.',
      explanation: 'La infografía de Canva subraya que la fotorrespiración reduce la eficiencia neta hasta un 25% en plantas C3 bajo estrés térmico.',
      sourceDocName: 'Infografia_Canva_Ciclo_Calvin_Fotosintesis.png',
      sourceSection: 'Nota destacada en infografía'
    },

    // Fill in the blank
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
      officialAnswer: 'Principio Pro Persona (o Pro Homine). Criterio que obliga a preferir la norma o interpretación más extensiva para tutelar derechos y la más restrictiva para limitar restricciones.',
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
      officialAnswer: 'RuBisCO (Ribulosa-1,5-bisfosfato carboxilasa-oxigenasa). Es la enzima más abundante de la biosfera y cataliza la fijación inicial de carbono.',
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
      officialAnswer: 'Fuerza protón-motriz (Δp = ΔΨ - 2.3 RT/F ΔpH). Suma vectorial del gradiente de carga eléctrica a través de la membrana y el gradiente químico de concentración de H+.',
      explanation: 'Fórmula manuscrita anotada a mano con tinta azul en los apuntes de biología celular.',
      sourceDocName: 'Apuntes_Manuscritos_Biologia_Celular.jpg',
      sourceSection: 'Fórmula bioenergética manuscrita'
    },

    // Open Questions
    {
      id: 'q-oq-1',
      type: 'open_question',
      difficulty: isJacqueline ? 'jacqueline' : 'medio',
      prompt: 'Explica la diferencia jurídica y los alcances prácticos entre el "Control Difuso" y el "Control Concentrado" de constitucionalidad según el documento de estudio.',
      correctAnswer: 'El control difuso es ejercido por cualquier juez ordinario en un caso concreto con efectos inter partes (inaplicando la ley para ese caso específico), mientras que el control concentrado está reservado a un tribunal constitucional especializado que puede declarar la inconstitucionalidad con efectos generales (erga omnes), expulsando la norma.',
      officialAnswer: 'Respuesta Oficial del Documento:\n1. Control Difuso: Ejercido por todos los jueces de la jurisdicción ordinaria al resolver un caso litigioso; su efecto es inaplicar la norma contraria a la Carta Magna únicamente "inter partes" para las partes procesales involucradas.\n2. Control Concentrado: Atribuido con exclusividad a una corte o tribunal constitucional especializado; opera por vía de acción directa y sus sentencias tienen efectos "erga omnes", derogando o expulsando la norma inválida del ordenamiento jurídico.',
      explanation: 'Contraste doctrinal extraído de la sección de sistemas de justicia constitucional en la Guía de Derecho Constitucional.',
      sourceDocName: 'Guia_Derecho_Constitucional_y_DDHH.pdf',
      sourceSection: 'Control Difuso vs Concentrado'
    },
    {
      id: 'q-oq-2',
      type: 'open_question',
      difficulty: isJacqueline ? 'jacqueline' : 'dificil',
      prompt: '¿Por qué la arquitectura Decoder-Only (como GPT y Gemini) utiliza enmascaramiento causal ("causal masking") durante la fase de atención?',
      correctAnswer: 'El enmascaramiento causal asegura que durante el entrenamiento autorregresivo la atención hacia cada token sólo pueda computarse respecto a los tokens previos de la secuencia y no a los futuros, impidiendo que el modelo haga trampa al predecir la siguiente palabra.',
      officialAnswer: 'Respuesta Oficial del Documento:\nEl enmascaramiento causal (causal masking) aplica una matriz triangular inferior con valores -infinito sobre las posiciones futuras antes del softmax. Esto garantiza que la representación de un token en la posición t solo dependa de las posiciones anteriores (1 a t), preservando la propiedad autorregresiva estricta para la generación secuencial de texto.',
      explanation: 'Detalle de ingeniería de atención descrito en la diapositiva 15 de la presentación técnica.',
      sourceDocName: 'Presentacion_Arquitecturas_LLM_Transformers.pptx',
      sourceSection: 'Diapositiva 15: Modelos Decoder-Only y Causal Masking'
    },
    {
      id: 'q-oq-3',
      type: 'open_question',
      difficulty: isJacqueline ? 'jacqueline' : 'jacqueline',
      prompt: isJacqueline
        ? 'NIVEL JACQUELINE: Analiza la interconexión energética global descrita en los documentos entre el estroma del cloroplasto (infografía Canva) y la cresta mitocondrial (apuntes manuscritos). ¿Cómo se acoplan los productos netos del ciclo fotosintético con el insumo de la fosforilación oxidativa?'
        : 'Describe cómo el Gliceraldehído-3-Fosfato (G3P) producido en el ciclo de Calvin se conecta metabólicamente con la respiración celular.',
      correctAnswer: 'El G3P neto sintetizado en el ciclo de Calvin exportado al citoplasma sirve de sustrato para la síntesis de glucosa. Esta glucosa ingresa a la glucólisis citosólica rindiendo piruvato, el cual entra a la matriz mitocondrial para alimentar el ciclo de Krebs y producir los equivalentes reductores (NADH y FADH2) que nutren la cadena transportadora de electrones mitocondrial.',
      officialAnswer: 'Respuesta Oficial Jacqueline (Correlación Inter-Documental):\n1. En el estroma del cloroplasto, la fase luminosa provee ATP y NADPH para reducir 3-PGA a G3P.\n2. La molécula neta de G3P es translocada al citosol para condensarse en glucosa y sacarosa.\n3. La glucosa alimenta la glucólisis (2 NADH netos y 2 piruvatos) y la decarboxilación oxidativa hacia Acetil-CoA en la matriz mitocondrial.\n4. El ciclo de Krebs genera NADH y FADH2, cuyos electrones de alta energía son transferidos a los Complejos I y II mitocondriales, activando la fuerza protón-motriz que hace rotar la ATP Sintasa.',
      explanation: 'Pregunta de síntesis de Nivel Jacqueline: cruza el reconocimiento de infografía Canva de fotosíntesis con los esquemas manuscritos de la cadena mitocondrial.',
      sourceDocName: 'Infografia_Canva_Ciclo_Calvin_Fotosintesis.png & Apuntes_Manuscritos_Biologia_Celular.jpg',
      sourceSection: 'Correlación Avanzada Multidocumental'
    }
  ];

  // Filter pool by allowed modalities
  const filtered = masterPool.filter(q => selectedModalities.includes(q.type));

  // If no items match (e.g. edge case), fallback to any
  const available = filtered.length > 0 ? filtered : masterPool;

  // Duplicate or slice to achieve desired count
  const result: Question[] = [];
  let index = 0;
  while (result.length < questionCount) {
    const template = available[index % available.length];
    result.push({
      ...template,
      id: `${template.id}-${result.length + 1}`,
      difficulty: difficulty
    });
    index++;
  }

  return result.slice(0, questionCount);
}
