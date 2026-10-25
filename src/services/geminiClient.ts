import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { UploadedDoc, QuizConfig, Question } from '../types';
import { generateFallbackQuestions, PRESET_SAMPLE_DOCUMENTS } from '../utils/quizEngine';

const VISITOR_KEY_STORAGE = 'studymaster_visitor_gemini_key';
const VISITOR_REMEMBER_STORAGE = 'studymaster_visitor_remember';

/**
 * Loads the visitor's saved key from localStorage or sessionStorage
 */
export function getSavedVisitorKey(): { apiKey: string; remember: boolean } {
  if (typeof window === 'undefined') return { apiKey: '', remember: false };

  const remembered = localStorage.getItem(VISITOR_REMEMBER_STORAGE) === 'true';
  const localKey = localStorage.getItem(VISITOR_KEY_STORAGE) || '';
  const sessionKey = sessionStorage.getItem(VISITOR_KEY_STORAGE) || '';

  const apiKey = remembered ? localKey : sessionKey || localKey;
  return { apiKey, remember: remembered };
}

/**
 * Saves visitor key strictly in client-side storage (sessionStorage by default, or localStorage if remember is checked)
 */
export function saveVisitorKey(apiKey: string, remember: boolean): void {
  if (typeof window === 'undefined') return;

  if (remember) {
    localStorage.setItem(VISITOR_KEY_STORAGE, apiKey);
    localStorage.setItem(VISITOR_REMEMBER_STORAGE, 'true');
    sessionStorage.removeItem(VISITOR_KEY_STORAGE);
  } else {
    sessionStorage.setItem(VISITOR_KEY_STORAGE, apiKey);
    localStorage.removeItem(VISITOR_KEY_STORAGE);
    localStorage.removeItem(VISITOR_REMEMBER_STORAGE);
  }
}

/**
 * Clears visitor key completely
 */
export function clearVisitorKey(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(VISITOR_KEY_STORAGE);
  localStorage.removeItem(VISITOR_KEY_STORAGE);
  localStorage.removeItem(VISITOR_REMEMBER_STORAGE);
}

/**
 * Validates the visitor's key directly with Google Gemini
 */
export async function validateVisitorGeminiKey(apiKey: string): Promise<{
  valid: boolean;
  model: string;
  error?: string;
}> {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, model: '', error: 'La key no puede estar vacía.' };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    // Probe using the recommended flash model
    const testModel = 'gemini-2.5-flash';
    const response = await ai.models.generateContent({
      model: testModel,
      contents: 'Ping: responde "OK" en una sola palabra',
    });

    if (response.text) {
      return { valid: true, model: testModel };
    }
    return { valid: false, model: '', error: 'La key no es válida o no tiene permisos suficientes.' };
  } catch (err: any) {
    const msg = err.message || '';
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      return {
        valid: true,
        model: 'gemini-2.5-flash',
        error: 'Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.',
      };
    }
    if (msg.includes('API key not valid') || msg.includes('PERMISSION_DENIED') || msg.includes('403') || msg.includes('400')) {
      return { valid: false, model: '', error: 'La key no es válida. Revisa que comience con AIzaSy... y esté copiada correctamente.' };
    }
    return { valid: false, model: '', error: `Error de conexión con Google: ${msg.slice(0, 120)}` };
  }
}

/**
 * Handles client-side multimodal OCR/HTR using the visitor's own Gemini key
 */
export async function analyzeVisitorDocWithGemini(
  doc: UploadedDoc,
  apiKey: string
): Promise<UploadedDoc['analysis']> {
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
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

  const promptText = `Eres un experto en EdTech y Visión por Computadora multimodal con OCR y HTR (Handwritten Text Recognition).
Analiza este documento ("${doc.name}") de estudio. Extrae con precisión:
1. Texto digital nativo y fórmulas.
2. Reconocimiento de texto escrito a mano (HTR) de pizarras, cuadernos o notas al margen.
3. Texto y relaciones dentro de diagramas, infografías (Canva/PPTX) o gráficos.
Responde estrictamente en formato JSON con la siguiente estructura:
{
  "summary": "Resumen conciso en español de los puntos clave para estudiar",
  "keyThemes": ["Concepto 1", "Concepto 2", "Concepto 3", "Concepto 4"],
  "hasHandwriting": true o false,
  "handwrittenNotes": ["Anotación manuscrita detectada 1", ...],
  "diagramDescriptions": ["Descripción de esquemas o diagramas detectados", ...],
  "multimodalNotes": "Observación sobre el análisis OCR/HTR visual",
  "extractedText": "Texto completo extraído o transcripción integral"
}
Texto previo o metadatos aportados: ${doc.rawText ? doc.rawText.slice(0, 3000) : 'Sin texto previo'}`;

  parts.push({ text: promptText });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts },
      config: { responseMimeType: 'application/json' },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    return {
      summary: parsed.summary || 'Documento analizado con éxito desde tu cuenta de Google.',
      keyThemes: parsed.keyThemes || ['Conceptos clave'],
      hasHandwriting: Boolean(parsed.hasHandwriting),
      handwrittenNotes: parsed.handwrittenNotes || [],
      diagramDescriptions: parsed.diagramDescriptions || [],
      multimodalNotes: parsed.multimodalNotes || 'Procesado mediante tu cuota personal de Gemini.',
      wordCount: (parsed.extractedText || doc.rawText || '').split(/\s+/).length,
    };
  } catch (err: any) {
    if (err.message?.includes('429')) {
      throw new Error('Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.');
    }
    throw err;
  }
}

/**
 * Handles client-side question generation using visitor's own Gemini key
 */
export async function generateVisitorQuestionsWithGemini(
  docs: UploadedDoc[],
  config: QuizConfig,
  apiKey: string
): Promise<Question[]> {
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const isJacqueline = config.difficulty === 'jacqueline';

  const docsContext = docs
    .map((d, idx) => `--- DOCUMENTO ${idx + 1}: ${d.name} (${d.category}) ---
${d.analysis?.summary ? `Resumen: ${d.analysis.summary}` : ''}
${d.analysis?.handwrittenNotes?.length ? `Notas manuscritas (HTR): ${d.analysis.handwrittenNotes.join('; ')}` : ''}
${d.analysis?.diagramDescriptions?.length ? `Diagramas/Esquemas: ${d.analysis.diagramDescriptions.join('; ')}` : ''}
Texto/Contenido:
${(d.rawText || '').slice(0, 6000)}
`)
    .join('\n\n');

  const systemPrompt = `Eres StudyMaster AI, un generador pedagógico de cuestionarios de alta precisión para EdTech.
Genera exactamente ${config.questionCount} preguntas basadas exclusivamente en el material proporcionado.

REGLAS DE MODALIDADES (Sólo usa estas modalidades permitidas: ${config.selectedModalities.join(', ')}):
1. 'multiple_choice': 4 opciones plausibles (A, B, C, D). Solo 1 respuesta correcta.
2. 'true_false': Afirmación clara. Opciones: ["Verdadero", "Falso"].
3. 'fill_blank': Oración clave donde se omite un concepto fundamental (fillInContext con sentenceBefore, targetWord, sentenceAfter).
4. 'open_question': Pregunta de desarrollo que exige sintetizar o justificar un punto del texto con officialAnswer detallada.

NIVEL DE DIFICULTAD ACTIVO: "${config.difficulty.toUpperCase()}".
${
  isJacqueline
    ? `🔥 ATENCIÓN: ESTE ES EL NIVEL "JACQUELINE (NIVEL MAESTRO / EXTREMO)".
Las preguntas deben ser ultra-específicas, altamente técnicas, de correlación cruzada entre documentos y detalles microscópicos.`
    : config.difficulty === 'dificil'
    ? 'Preguntas de análisis profundo, inferencia compleja y aplicación práctica.'
    : config.difficulty === 'medio'
    ? 'Preguntas de comprensión y relación de conceptos.'
    : 'Preguntas directas sobre conceptos básicos y definiciones literales.'
}

Devuelve ÚNICAMENTE un array JSON con las preguntas (id, type, difficulty, prompt, options, correctAnswer, fillInContext, officialAnswer, explanation, sourceDocName).`;

  try {
    const chosenModel = 'gemini-2.5-flash';
    const response = await ai.models.generateContent({
      model: chosenModel,
      contents: `${systemPrompt}\n\nMATERIALES DE ESTUDIO:\n${docsContext}`,
      config: {
        ...(isJacqueline ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {}),
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return generateFallbackQuestions(docs.length > 0 ? docs : PRESET_SAMPLE_DOCUMENTS, config);
  } catch (err: any) {
    if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.');
    }
    console.warn('Error with visitor key, using fallback:', err);
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
  apiKey: string
): Promise<{ isCorrect: boolean; feedback: string }> {
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

  const prompt = `Actúa como un profesor evaluador estricto pero justo.
Pregunta: "${questionPrompt}"
Respuesta oficial esperada del documento: "${officialAnswer}"
Respuesta del estudiante: "${studentAnswer}"

Evalúa si la respuesta del estudiante demuestra comprensión sustancial del concepto central.
Responde estrictamente en JSON con este formato:
{
  "isCorrect": true o false,
  "feedback": "Breve explicación pedagógica de 1 o 2 oraciones indicando qué acertó o qué elemento clave omitió."
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    return {
      isCorrect: Boolean(parsed.isCorrect),
      feedback: parsed.feedback || 'Evaluado con éxito mediante Gemini con tu cuenta de Google.',
    };
  } catch (err: any) {
    if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.');
    }
    throw err;
  }
}
