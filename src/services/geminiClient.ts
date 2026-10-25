import { GoogleGenAI } from '@google/genai';
import { UploadedDoc, QuizConfig, Question } from '../types';
import { generateFallbackQuestions, sanitizeAndValidateQuestions } from '../utils/quizEngine';
import { cleanExtractedText } from '../utils/documentParser';

const VISITOR_KEY_STORAGE = 'studymaster_visitor_gemini_key';
const VISITOR_MODEL_STORAGE = 'studymaster_visitor_gemini_model';
const VISITOR_REMEMBER_STORAGE = 'studymaster_visitor_remember';

/**
 * Active Flash models ordered from most compatible for new Google AI Studio keys.
 * Never starts with deprecated 'gemini-2.5-flash' which returns 404 for new users.
 */
export const CANDIDATE_FLASH_MODELS = [
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-lite',
];

export const DEFAULT_VISITOR_FLASH_MODEL = 'gemini-flash-latest';

function sanitizeModelName(model?: string | null): string {
  if (!model) return DEFAULT_VISITOR_FLASH_MODEL;
  const cleaned = model.replace(/^models\//, '').trim();
  // Replace deprecated models that fail with 404 for new users
  if (
    !cleaned ||
    cleaned === 'gemini-2.5-flash' ||
    cleaned === 'gemini-2.0-flash' ||
    cleaned === 'gemini-1.5-flash'
  ) {
    return DEFAULT_VISITOR_FLASH_MODEL;
  }
  return cleaned;
}

/**
 * Loads the visitor's saved key and validated Flash model from localStorage or sessionStorage
 */
export function getSavedVisitorKey(): { apiKey: string; remember: boolean; model: string } {
  if (typeof window === 'undefined') {
    return { apiKey: '', remember: false, model: DEFAULT_VISITOR_FLASH_MODEL };
  }

  const remembered = localStorage.getItem(VISITOR_REMEMBER_STORAGE) === 'true';
  const localKey = localStorage.getItem(VISITOR_KEY_STORAGE) || '';
  const sessionKey = sessionStorage.getItem(VISITOR_KEY_STORAGE) || '';

  const localModel = localStorage.getItem(VISITOR_MODEL_STORAGE) || '';
  const sessionModel = sessionStorage.getItem(VISITOR_MODEL_STORAGE) || '';

  const apiKey = remembered ? localKey : sessionKey || localKey;
  const rawModel = remembered ? localModel : sessionModel || localModel;
  const model = apiKey ? sanitizeModelName(rawModel) : '';

  return { apiKey, remember: remembered, model };
}

/**
 * Saves visitor key and active model strictly in client-side storage
 */
export function saveVisitorKey(apiKey: string, remember: boolean, model?: string): void {
  if (typeof window === 'undefined') return;
  const validModel = sanitizeModelName(model);

  if (remember) {
    localStorage.setItem(VISITOR_KEY_STORAGE, apiKey);
    localStorage.setItem(VISITOR_MODEL_STORAGE, validModel);
    localStorage.setItem(VISITOR_REMEMBER_STORAGE, 'true');
    sessionStorage.removeItem(VISITOR_KEY_STORAGE);
    sessionStorage.removeItem(VISITOR_MODEL_STORAGE);
  } else {
    sessionStorage.setItem(VISITOR_KEY_STORAGE, apiKey);
    sessionStorage.setItem(VISITOR_MODEL_STORAGE, validModel);
    localStorage.removeItem(VISITOR_KEY_STORAGE);
    localStorage.removeItem(VISITOR_MODEL_STORAGE);
    localStorage.removeItem(VISITOR_REMEMBER_STORAGE);
  }
}

/**
 * Clears visitor key completely
 */
export function clearVisitorKey(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(VISITOR_KEY_STORAGE);
  sessionStorage.removeItem(VISITOR_MODEL_STORAGE);
  localStorage.removeItem(VISITOR_KEY_STORAGE);
  localStorage.removeItem(VISITOR_MODEL_STORAGE);
  localStorage.removeItem(VISITOR_REMEMBER_STORAGE);
}

/**
 * Picks the best available Flash text model from the list returned by GET /v1beta/models
 */
export function selectBestFlashModelFromList(models: Array<{ name?: string; supportedGenerationMethods?: string[] }>): string {
  const availableIds: string[] = [];

  for (const m of models) {
    const rawName = (m.name || '').replace(/^models\//, '');
    const methods = m.supportedGenerationMethods || [];
    if (!rawName) continue;
    if (methods.length > 0 && !methods.includes('generateContent')) continue;

    const lower = rawName.toLowerCase();
    // Skip deprecated or non-text specialized models
    if (
      lower === 'gemini-2.5-flash' ||
      lower.startsWith('gemini-1.5') ||
      lower.startsWith('gemini-2.0') ||
      lower.includes('tts') ||
      lower.includes('image') ||
      lower.includes('embedding') ||
      lower.includes('veo') ||
      lower.includes('lyria') ||
      lower.includes('imagen') ||
      lower.includes('aqa') ||
      lower.includes('audio') ||
      lower.includes('robotics') ||
      lower.includes('computer-use')
    ) {
      continue;
    }

    if (lower.includes('flash')) {
      availableIds.push(rawName);
    }
  }

  for (const preferred of CANDIDATE_FLASH_MODELS) {
    if (availableIds.includes(preferred)) {
      return preferred;
    }
  }

  if (availableIds.length > 0) {
    return availableIds[0];
  }

  return DEFAULT_VISITOR_FLASH_MODEL;
}

/**
 * Validates the visitor's key by calling the Gemini Models List API and selecting an active Flash model.
 * Never fails with 404 from deprecated gemini-2.5-flash.
 */
export async function validateVisitorGeminiKey(apiKey: string): Promise<{
  valid: boolean;
  model: string;
  error?: string;
}> {
  const cleanKey = (apiKey || '').trim().replace(/^["']|["']$/g, '');
  if (!cleanKey) {
    return { valid: false, model: '', error: 'La key no puede estar vacía.' };
  }

  // 1. Validate by calling the official Gemini Models List endpoint (zero quota cost & discovers available Flash models)
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
    const listRes = await fetch(listUrl, { method: 'GET' });

    if (listRes.ok) {
      const data = await listRes.json();
      const modelsList = Array.isArray(data?.models) ? data.models : [];
      const chosenModel = selectBestFlashModelFromList(modelsList);
      return { valid: true, model: chosenModel };
    }

    const errData = await listRes.json().catch(() => ({}));
    const errMsg = errData?.error?.message || '';
    const errStatus = listRes.status;

    if (errStatus === 429 || errMsg.includes('RESOURCE_EXHAUSTED')) {
      return {
        valid: true,
        model: DEFAULT_VISITOR_FLASH_MODEL,
        error: 'Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.',
      };
    }

    // If key was explicitly rejected as invalid API key
    if (
      errStatus === 400 ||
      errStatus === 403 ||
      errMsg.toLowerCase().includes('api key not valid') ||
      errMsg.toLowerCase().includes('api_key_invalid')
    ) {
      // Wait: if the user pasted an AQ.* key or environment token, test via SDK fallback before rejecting
      if (!cleanKey.startsWith('AQ.')) {
        return {
          valid: false,
          model: '',
          error: 'La key no es válida. Asegúrate de copiar la clave generada en Google AI Studio (Create API key).',
        };
      }
    }
  } catch {
    // Network / CORS fallback to SDK probe below
  }

  // 2. Fallback probe across active Flash models using @google/genai SDK
  const ai = new GoogleGenAI({ apiKey: cleanKey });
  let sawModel404 = false;
  let lastErrorMsg = '';

  for (const candidateModel of CANDIDATE_FLASH_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model: candidateModel,
        contents: 'Responde OK',
      });
      if (response && (response.text || response.candidates)) {
        return { valid: true, model: candidateModel };
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      lastErrorMsg = msg;

      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        return {
          valid: true,
          model: candidateModel,
          error: 'Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.',
        };
      }

      // If this specific model returned 404 ("no longer available to new users" / "not found"),
      // it means Google authenticated the key and only rejected the model name! Try next model.
      if (msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('no longer available') || msg.includes('not found')) {
        sawModel404 = true;
        continue;
      }

      if (msg.includes('API key not valid') || msg.includes('API_KEY_INVALID')) {
        return {
          valid: false,
          model: '',
          error: 'La key ingresada no es válida. Verifica que hayas copiado la clave completa desde Google AI Studio.',
        };
      }
    }
  }

  // If Google returned 404 model not found on the key, the key itself was authenticated by Google
  if (sawModel404) {
    return { valid: true, model: DEFAULT_VISITOR_FLASH_MODEL };
  }

  return {
    valid: false,
    model: '',
    error: `La key no es válida o no se pudo verificar (${lastErrorMsg.slice(0, 100) || 'Revisa tu clave en Google AI Studio'}).`,
  };
}

/**
 * Helper that executes a Gemini generateContent call trying the user's preferred Flash model first
 * and automatically falling back through CANDIDATE_FLASH_MODELS if a model returns 404.
 */
async function callVisitorGeminiWithFallback(
  apiKey: string,
  preferredModel: string | undefined,
  buildRequest: (model: string) => Parameters<GoogleGenAI['models']['generateContent']>[0]
) {
  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, '');
  const ai = new GoogleGenAI({ apiKey: cleanKey });

  const startModel = sanitizeModelName(preferredModel || getSavedVisitorKey().model);
  const modelsToTry = [
    startModel,
    ...CANDIDATE_FLASH_MODELS.filter(m => m !== startModel),
  ];

  let lastErr: any = null;
  for (const model of modelsToTry) {
    try {
      const res = await ai.models.generateContent(buildRequest(model));
      return res;
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || String(err);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        throw new Error('Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.');
      }
      // If model is 404 / deprecated / unavailable for this user, try the next Flash model automatically
      if (msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('no longer available') || msg.includes('not found')) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('No se encontró un modelo Flash disponible para esta cuenta.');
}

/**
 * Handles client-side multimodal OCR/HTR using the visitor's own Gemini key
 */
export async function analyzeVisitorDocWithGemini(
  doc: UploadedDoc,
  apiKey: string,
  preferredModel?: string
): Promise<{ analysis: UploadedDoc['analysis']; extractedText?: string }> {
  const parts: any[] = [];

  if (doc.base64Data && doc.mimeType) {
    const cleanBase64 = doc.base64Data.replace(/^data:[^;]+;base64,/, '');
    parts.push({
      inlineData: {
        data: cleanBase64,
        mimeType: doc.mimeType,
      },
    });
  }

  const cleanedPriorText = cleanExtractedText(doc.rawText || '');
  const promptText = `Eres un experto en EdTech y Visión por Computadora multimodal con OCR y HTR (Handwritten Text Recognition).
Analiza este documento ("${doc.name}") de estudio. Extrae con precisión todo su contenido real:
1. Texto digital nativo, conceptos, títulos temáticos, datos y fórmulas.
2. Reconocimiento de texto escrito a mano (HTR) de pizarras, cuadernos o notas al margen.
3. Texto y relaciones dentro de diagramas, infografías (Canva/PPTX) o gráficos, e imágenes incrustadas en el documento.
Responde estrictamente en formato JSON con la siguiente estructura:
{
  "summary": "Resumen conciso en español de los puntos clave reales del documento",
  "keyThemes": ["Tema o Concepto 1", "Tema o Concepto 2", "Tema o Concepto 3", "Tema o Concepto 4"],
  "hasHandwriting": true o false,
  "handwrittenNotes": ["Anotación manuscrita detectada 1", ...],
  "diagramDescriptions": ["Descripción de esquemas o diagramas detectados", ...],
  "multimodalNotes": "Observación sobre el análisis OCR/HTR visual",
  "extractedText": "Transcripción limpia, completa y estructurada por temas de todo el texto e información del documento"
}
Texto extraído previamente del archivo: ${cleanedPriorText ? cleanedPriorText.slice(0, 8000) : 'Extraer directamente desde el archivo adjunto'}`;

  parts.push({ text: promptText });

  const response = await callVisitorGeminiWithFallback(apiKey, preferredModel, (model) => ({
    model,
    contents: { parts },
    config: { responseMimeType: 'application/json' },
  }));

  const parsed = JSON.parse(response.text?.trim() || '{}');
  const extractedText = cleanExtractedText(parsed.extractedText || cleanedPriorText || '');

  return {
    extractedText,
    analysis: {
      summary: cleanExtractedText(parsed.summary || '') || 'Documento analizado con éxito desde tu cuenta de Google.',
      keyThemes: Array.isArray(parsed.keyThemes) ? parsed.keyThemes.map((t: string) => cleanExtractedText(t)).filter(Boolean) : ['Conceptos clave'],
      hasHandwriting: Boolean(parsed.hasHandwriting),
      handwrittenNotes: Array.isArray(parsed.handwrittenNotes) ? parsed.handwrittenNotes.map((n: string) => cleanExtractedText(n)).filter(Boolean) : [],
      diagramDescriptions: Array.isArray(parsed.diagramDescriptions) ? parsed.diagramDescriptions.map((d: string) => cleanExtractedText(d)).filter(Boolean) : [],
      multimodalNotes: parsed.multimodalNotes || 'Procesado mediante tu cuota personal de Gemini.',
      wordCount: extractedText.split(/\s+/).filter(Boolean).length,
    },
  };
}

/**
 * Handles client-side question generation using visitor's own Gemini key.
 * Strictly restricts all generated questions to the provided `docs`.
 */
export async function generateVisitorQuestionsWithGemini(
  docs: UploadedDoc[],
  config: QuizConfig,
  apiKey: string,
  preferredModel?: string
): Promise<Question[]> {
  const isJacqueline = config.difficulty === 'jacqueline';

  const docsContext = docs
    .map((d, idx) => {
      const cleanRaw = cleanExtractedText(d.rawText || '');
      return `=== DOCUMENTO SUBIDO #${idx + 1}: "${d.name}" (${d.category}) ===
${d.analysis?.summary ? `Resumen del documento: ${cleanExtractedText(d.analysis.summary)}` : ''}
${d.analysis?.keyThemes?.length ? `Temas clave: ${d.analysis.keyThemes.join(', ')}` : ''}
${d.analysis?.handwrittenNotes?.length ? `Notas manuscritas (HTR): ${d.analysis.handwrittenNotes.join('; ')}` : ''}
${d.analysis?.diagramDescriptions?.length ? `Diagramas/Esquemas: ${d.analysis.diagramDescriptions.join('; ')}` : ''}
Contenido textual limpio del documento:
${cleanRaw.slice(0, 12000)}
`;
    })
    .join('\n\n');

  const allowedDocNames = docs.map(d => `"${d.name}"`).join(', ');

  const variationNonce = Date.now() % 10000;
  const difficultyProfileInstructions =
    config.difficulty === 'jacqueline'
      ? `🔥 NIVEL ACTIVO: "JACQUELINE (NIVEL MAESTRO / EXTREMO)"
- PROHIBIDO hacer preguntas simples o idénticas al modo Difícil (POVEDA).
- Exige SÍNTESIS INTEGRADORA CRUZADA: cada pregunta debe correlacionar al menos 2 conceptos, mecanismos o secciones distintas del documento.
- En 'multiple_choice' y 'true_false', utiliza proposiciones compuestas de doble cláusula (Premisa I + Premisa II) donde las opciones incorrectas sean trampas académicas sutiles (ej. la primera mitad del enunciado es verdadera pero la segunda mitad invierte una condición clave).`
      : config.difficulty === 'dificil'
      ? `⚡ NIVEL ACTIVO: "DIFÍCIL (POVEDA) — RIGOR ANALÍTICO Y EXCEPCIONES"
- Aplica el estándar de evaluación exigente POVEDA: evalúa condiciones técnicas necesarias, discriminación fina de mecanismos y detección de errores conceptuales.
- Incluye preguntas de análisis de excepción ("¿Cuál de las siguientes afirmaciones sobre [Subtema] constituye un ERROR conceptual o es FALSA?", donde 3 opciones son verdaderas y 1 es falsa) y preguntas sobre qué condición específica valida o invalida un proceso.`
      : config.difficulty === 'medio'
      ? `📘 NIVEL ACTIVO: "MEDIO — COMPRENSIÓN FUNCIONAL Y MECANISMOS"
- Evalúa cómo funcionan los procesos (¿mediante qué mecanismo o vía?), con qué finalidad se realizan (¿para qué sirve X en el contexto de Y?) y las relaciones causa-efecto dentro de cada tema.`
      : `🟢 NIVEL ACTIVO: "FÁCIL — DEFINICIONES Y CONCEPTOS FUNDAMENTALES"
- Evalúa la identificación directa y clara de definiciones esenciales, conceptos principales y características explícitas del documento.`;

  const systemPrompt = `Eres StudyMaster AI, un generador pedagógico de cuestionarios de alta precisión.
Genera exactamente ${config.questionCount} preguntas variadas que cubran DIVERSAS TEMÁTICAS Y SECCIONES de todo el documento (inicio, desarrollo y cierre; jamás repitas siempre el mismo tema) basadas ÚNICA Y EXCLUSIVAMENTE en el contenido de los documentos subidos en esta sesión (${allowedDocNames}).
Semilla de variación de sesión: #${variationNonce} (asegúrate de explorar ángulos, subtemas y formulaciones frescas y variadas).

REGLA ESTRICTA DE CONTEXTO COMPLETO Y REDACCIÓN DIRECTA:
- Cada pregunta DEBE especificar con total claridad y contexto qué se está preguntando exactamente y sobre qué sujeto/proceso (jamás hagas preguntas ambiguas o incompletas sin contexto).
- Ve DIRECTAMENTE a la pregunta bien redactada o al enunciado completo.
- PROHIBIDO iniciar las preguntas o las opciones con muletillas como "En la sección X del libro...", "En el apartado Y del manual...", "En la página Z...", "Según el documento...", "De acuerdo con el texto...".
- Todas las preguntas y respuestas deben estar 100% completas (jamás recortadas a la mitad), bien redactadas y con lógica pedagógica impecable.
- El campo "sourceDocName" DEBE ser exactamente uno de estos nombres: ${allowedDocNames}.

ENCABEZADO DOBLE OBLIGATORIO EN CADA PREGUNTA ("topicTitle" + "specificTopic"):
- "topicTitle" (OBLIGATORIO): El TEMA PRINCIPAL general al que pertenece la pregunta (ej. "Psicodiagnóstico Clínico y Entrevista", "Respiración Celular Mitocondrial").
- "specificTopic" (OBLIGATORIO): El SUBTEMA o CONCEPTO ESPECÍFICO puntual sobre el que se está preguntando en esta pregunta en particular (ej. "Objetivos de la entrevista semidirigida inicial", "Función del Complejo II en la membrana interna"). Cada pregunta del test debe abordar un "specificTopic" distinto.

REGLAS DE MODALIDADES (Usa únicamente estas modalidades seleccionadas: ${config.selectedModalities.join(', ')}):
1. 'multiple_choice': Pregunta directa y contextualizada con 4 opciones plausibles, completas y bien redactadas. Solo 1 respuesta correcta ("correctAnswer" debe ser idéntica a una de las 4 opciones).
2. 'true_false': Proposición directa, completa y con sentido propio. Opciones: ["Verdadero", "Falso"]. "correctAnswer": "Verdadero" o "Falso".
3. 'fill_blank': Instrucción clara en "prompt" y oración completa con contexto lógico en "fillInContext" ("sentenceBefore", "targetWord", "sentenceAfter", y "correctAnswer" igual a "targetWord").
4. 'open_question': Pregunta abierta directa, contextualizada y analítica con "officialAnswer" completa y "explanation" pedagógica detallada.

DIFERENCIACIÓN ESTRICTA POR NIVEL DE DIFICULTAD:
${difficultyProfileInstructions}

Devuelve ÚNICAMENTE un array JSON válido con objetos que tengan: id, type, difficulty, topicTitle, specificTopic, prompt, options, correctAnswer, fillInContext, officialAnswer, explanation, sourceDocName.`;

  try {
    // Attach inlineData for uploaded PDF/image documents so Gemini reads visual text, tables, and embedded images directly
    const parts: any[] = [];
    for (const d of docs) {
      if (d.base64Data && d.mimeType && (d.category === 'image' || d.category === 'canva' || d.category === 'pdf')) {
        const cleanBase64 = d.base64Data.replace(/^data:[^;]+;base64,/, '');
        if (cleanBase64.length < 18 * 1024 * 1024) {
          parts.push({
            inlineData: {
              data: cleanBase64,
              mimeType: d.mimeType === 'application/octet-stream' && d.category === 'pdf' ? 'application/pdf' : d.mimeType,
            },
          });
        }
      }
    }
    parts.push({ text: `${systemPrompt}\n\nDOCUMENTOS DE LA SESIÓN DE ESTUDIO:\n${docsContext}` });

    const response = await callVisitorGeminiWithFallback(apiKey, preferredModel, (model) => ({
      model,
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
      },
    }));

    const parsed = JSON.parse(response.text?.trim() || '[]');
    const questions = Array.isArray(parsed) ? parsed : parsed.questions || [];
    return sanitizeAndValidateQuestions(questions, docs, config);
  } catch (err: any) {
    if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('Alcanzaste el límite')) {
      throw new Error('Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.');
    }
    console.warn('Error with visitor key, using document-exclusive local generator:', err);
    throw err;
  }
}

/**
 * Validates student open-ended answers against official answer using visitor's Gemini key
 */
export async function evaluateVisitorOpenAnswerWithGemini(
  questionPrompt: string,
  officialAnswer: string,
  studentAnswer: string,
  apiKey: string,
  preferredModel?: string
): Promise<{ isCorrect: boolean; feedback: string }> {
  const prompt = `Actúa como un profesor evaluador estricto pero justo basándote exclusivamente en la respuesta oficial del documento.
Pregunta: "${questionPrompt}"
Respuesta oficial esperada del documento: "${officialAnswer}"
Respuesta del estudiante: "${studentAnswer}"

Evalúa si la respuesta del estudiante demuestra comprensión sustancial del concepto central del documento.
Responde estrictamente en JSON con este formato:
{
  "isCorrect": true o false,
  "feedback": "Breve explicación pedagógica de 1 o 2 oraciones indicando qué acertó o qué elemento clave del documento omitió."
}`;

  const response = await callVisitorGeminiWithFallback(apiKey, preferredModel, (model) => ({
    model,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  }));

  const parsed = JSON.parse(response.text?.trim() || '{}');
  return {
    isCorrect: Boolean(parsed.isCorrect),
    feedback: parsed.feedback || 'Evaluado con éxito mediante Gemini con tu cuenta de Google.',
  };
}
