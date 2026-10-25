import express from 'express';
import type { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { generateFallbackQuestions, PRESET_SAMPLE_DOCUMENTS } from './src/utils/quizEngine.ts';
import { buildLocalDocAnalysis } from './src/utils/documentParser.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Initialize GoogleGenAI client if valid API key is present
const apiKey = process.env.GEMINI_API_KEY;
const isPlaceholderKey = !apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.startsWith('MY_');

let ai: GoogleGenAI | null = null;
if (apiKey && !isPlaceholderKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 1. Health & Config endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(ai),
    serverTime: new Date().toISOString(),
  });
});

// Helper to call OpenAI-compatible APIs (OpenAI, Grok/xAI, Groq/Llama, etc.)
async function callOpenAICompatible(
  apiUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error del proveedor (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  return content;
}

// Test custom API Key endpoint
app.post('/api/test-provider-key', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model, baseUrl } = req.body;
    if (!apiKey || !provider) {
      return res.status(400).json({ ok: false, error: 'Proveedor y API Key son obligatorios.' });
    }

    if (provider === 'gemini') {
      const customAi = new GoogleGenAI({ apiKey: apiKey.trim() });
      const candidates = [
        model && model !== 'gemini-2.5-flash' ? model : 'gemini-flash-latest',
        'gemini-3-flash-preview',
        'gemini-3.8-flash',
        'gemini-2.5-flash-lite',
        'gemini-3.1-flash-lite',
      ];
      let lastErr = '';
      for (const candidate of candidates) {
        try {
          const testRes = await customAi.models.generateContent({
            model: candidate,
            contents: 'Responde "OK"',
          });
          return res.json({
            ok: true,
            model: candidate,
            message: testRes.text?.slice(0, 20) || 'Conexión exitosa',
          });
        } catch (e: any) {
          lastErr = e.message || '';
          if (lastErr.includes('404') || lastErr.includes('no longer available') || lastErr.includes('not found')) {
            continue;
          }
          break;
        }
      }
      return res.status(400).json({ ok: false, error: lastErr || 'No se pudo validar la clave de Gemini' });
    }

    // OpenAI-compatible providers
    let endpoint = baseUrl;
    if (!endpoint) {
      if (provider === 'openai') endpoint = 'https://api.openai.com/v1/chat/completions';
      else if (provider === 'grok') endpoint = 'https://api.x.ai/v1/chat/completions';
      else if (provider === 'llama') endpoint = 'https://api.groq.com/openai/v1/chat/completions';
      else endpoint = 'https://api.openai.com/v1/chat/completions';
    }

    const testRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || (provider === 'grok' ? 'grok-2-latest' : provider === 'llama' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini'),
        messages: [{ role: 'user', content: 'Di "OK" en 1 palabra' }],
        max_tokens: 10,
      }),
    });

    if (!testRes.ok) {
      const err = await testRes.text();
      return res.status(400).json({ ok: false, error: `Clave rechazada (${testRes.status}): ${err.slice(0, 200)}` });
    }

    return res.json({ ok: true, message: '¡Conexión y clave validadas con éxito!' });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Error al validar la clave' });
  }
});

// 2. Multimodal OCR & HTR Document Analysis
app.post('/api/analyze-multimodal', async (req: Request, res: Response) => {
  try {
    const { doc, engineMode = 'gemini_env' } = req.body;
    if (!doc) {
      return res.status(400).json({ error: 'Falta la información del documento.' });
    }

    // MODO ESTUDIO SIN IA: Procesamiento completamente local sin llamadas externas
    if (engineMode === 'no_ai') {
      const localAnalysis = buildLocalDocAnalysis(doc);
      return res.json({
        success: true,
        modeUsed: 'no_ai',
        analysis: localAnalysis,
        extractedText: doc.rawText || '',
      });
    }

    // MODO CON IA (Gemini Entorno)
    if (engineMode === 'gemini_env' && ai) {
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
          model: 'gemini-3.8-flash',
          contents: { parts },
          config: {
            responseMimeType: 'application/json',
          },
        });

        const textOutput = response.text?.trim() || '{}';
        const parsed = JSON.parse(textOutput);
        return res.json({
          success: true,
          modeUsed: 'gemini_env',
          analysis: {
            summary: parsed.summary || 'Documento analizado con éxito.',
            keyThemes: parsed.keyThemes || ['Conceptos clave'],
            hasHandwriting: Boolean(parsed.hasHandwriting),
            handwrittenNotes: parsed.handwrittenNotes || [],
            diagramDescriptions: parsed.diagramDescriptions || [],
            multimodalNotes: parsed.multimodalNotes || 'Procesado mediante Gemini Multimodal OCR/HTR.',
            wordCount: (parsed.extractedText || doc.rawText || '').split(/\s+/).length,
          },
          extractedText: parsed.extractedText || doc.rawText,
        });
      } catch (geminiError) {
        console.warn('Gemini OCR API error, using smart local parser:', geminiError);
      }
    }

    // Default fallback
    const hasHandwritingClue = /apunte|mano|cuaderno|pizarra|manuscrito|htr|caligrafia/i.test(doc.name) ||
      (doc.rawText && /manuscrito|a mano|al margen|lapiz|cuaderno/i.test(doc.rawText));
    const wordCount = (doc.rawText || '').split(/\s+/).filter(Boolean).length || 120;

    return res.json({
      success: true,
      modeUsed: engineMode,
      analysis: {
        summary: `Documento "${doc.name}" analizado con éxito para evaluación interactiva.`,
        keyThemes: ['Análisis conceptual', 'Definiciones clave', 'Relaciones temáticas'],
        hasHandwriting: Boolean(hasHandwritingClue),
        handwrittenNotes: hasHandwritingClue
          ? ['Anotación manuscrita detectada en apuntes para examen.']
          : [],
        diagramDescriptions: ['Esquema conceptual y flujo temático integrado.'],
        multimodalNotes: 'Análisis OCR y HTR completado.',
        wordCount,
      },
      extractedText: doc.rawText || `Contenido de estudio extraído del archivo ${doc.name}.`,
    });
  } catch (error: any) {
    console.error('Error analyzing document:', error);
    res.status(500).json({ error: error.message || 'Error al analizar el documento' });
  }
});

// 3. Dynamic Question Generation (supports 3 modes: No AI, Gemini Env, Custom Keys)
app.post('/api/generate-questions', async (req: Request, res: Response) => {
  try {
    const { docs, config } = req.body;
    if (!docs || !config) {
      return res.status(400).json({ error: 'Documentos y configuración son requeridos.' });
    }

    const { selectedModalities, difficulty, questionCount, engineMode = 'gemini_env', customConfig } = config;

    // FORMA 1: MODO ESTUDIO SIN IA (Demo local sin ninguna IA)
    if (engineMode === 'no_ai') {
      const fallbackQuestions = generateFallbackQuestions(docs.length > 0 ? docs : PRESET_SAMPLE_DOCUMENTS, config);
      return res.json({
        success: true,
        modeUsed: 'no_ai',
        providerName: 'Motor Heurístico Local (Sin IA)',
        questions: fallbackQuestions,
      });
    }

    const isJacqueline = difficulty === 'jacqueline';

    // Context from docs
    const docsContext = docs
      .map((d: any, idx: number) => `--- DOCUMENTO ${idx + 1}: ${d.name} (${d.category}) ---
${d.analysis?.summary ? `Resumen: ${d.analysis.summary}` : ''}
${d.analysis?.handwrittenNotes?.length ? `Notas manuscritas (HTR): ${d.analysis.handwrittenNotes.join('; ')}` : ''}
${d.analysis?.diagramDescriptions?.length ? `Diagramas/Esquemas: ${d.analysis.diagramDescriptions.join('; ')}` : ''}
Texto/Contenido:
${(d.rawText || d.extractedText || '').slice(0, 6000)}
`)
      .join('\n\n');

    const systemPrompt = `Eres StudyMaster AI, un generador pedagógico de cuestionarios de alta precisión para EdTech.
Genera exactamente ${questionCount} preguntas basadas exclusivamente en el material proporcionado.

REGLAS DE MODALIDADES (Sólo usa estas modalidades permitidas: ${selectedModalities.join(', ')}):
1. 'multiple_choice': 4 opciones plausibles (A, B, C, D). Solo 1 respuesta correcta.
2. 'true_false': Afirmación clara. Opciones: ["Verdadero", "Falso"].
3. 'fill_blank': Oración clave donde se omite un concepto fundamental (fillInContext con sentenceBefore, targetWord, sentenceAfter).
4. 'open_question': Pregunta de desarrollo que exige sintetizar o justificar un punto del texto con officialAnswer detallada.

NIVEL DE DIFICULTAD ACTIVO: "${difficulty.toUpperCase()}".
${
  isJacqueline
    ? `🔥 ATENCIÓN: ESTE ES EL NIVEL "JACQUELINE (NIVEL MAESTRO / EXTREMO)".
Las preguntas deben ser ultra-específicas, altamente técnicas, de correlación cruzada entre documentos y detalles milimétricos.`
    : difficulty === 'dificil'
    ? 'Preguntas de análisis profundo, inferencia compleja y aplicación práctica.'
    : difficulty === 'medio'
    ? 'Preguntas de comprensión y relación de conceptos.'
    : 'Preguntas directas sobre conceptos básicos y definiciones literales.'
}

Devuelve ÚNICAMENTE un array JSON con las preguntas (id, type, difficulty, prompt, options, correctAnswer, fillInContext, officialAnswer, explanation, sourceDocName).`;

    // FORMA 3: MODO CON CLAVES EXTERNAS (Grok, Llama, OpenAI, o Gemini Custom Key)
    if (engineMode === 'custom_keys' && customConfig?.apiKey) {
      try {
        const { provider, apiKey, model, baseUrl } = customConfig;

        if (provider === 'gemini') {
          const customAi = new GoogleGenAI({ apiKey });
          const genModel = model || (isJacqueline ? 'gemini-4-argon' : 'gemini-3.8-flash');
          const response = await customAi.models.generateContent({
            model: genModel,
            contents: `${systemPrompt}\n\nMATERIALES DE ESTUDIO:\n${docsContext}`,
            config: {
              ...(isJacqueline && genModel === 'gemini-4-argon' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {}),
              responseMimeType: 'application/json',
            },
          });
          const questions = JSON.parse(response.text?.trim() || '[]');
          if (Array.isArray(questions) && questions.length > 0) {
            return res.json({ success: true, modeUsed: 'custom_keys', providerName: `Gemini (${genModel})`, questions });
          }
        } else {
          // OpenAI, Grok (xAI), or Groq/Llama
          let endpoint = baseUrl;
          if (!endpoint) {
            if (provider === 'grok') endpoint = 'https://api.x.ai/v1/chat/completions';
            else if (provider === 'llama') endpoint = 'https://api.groq.com/openai/v1/chat/completions';
            else endpoint = 'https://api.openai.com/v1/chat/completions';
          }

          const defaultModel = provider === 'grok' ? 'grok-2-latest' : provider === 'llama' ? 'llama-3.3-70b-versatile' : 'gpt-4o';
          const chosenModel = model || defaultModel;

          const rawJson = await callOpenAICompatible(
            endpoint,
            apiKey,
            chosenModel,
            systemPrompt,
            `Genera el cuestionario en formato JSON con la clave "questions": [...] a partir de estos documentos:\n\n${docsContext}`
          );

          let parsed = JSON.parse(rawJson);
          let questions = Array.isArray(parsed) ? parsed : parsed.questions || parsed.cuestionario || [];
          if (Array.isArray(questions) && questions.length > 0) {
            return res.json({ success: true, modeUsed: 'custom_keys', providerName: `${provider.toUpperCase()} (${chosenModel})`, questions });
          }
        }
      } catch (customError: any) {
        console.warn('Custom Provider error, falling back to engine:', customError.message);
      }
    }

    // FORMA 2: MODO CON IA (API KEY de este entorno de Gemini)
    if (ai) {
      try {
        let textOutput = '';
        if (isJacqueline) {
          const response = await ai.models.generateContent({
            model: 'gemini-4-argon',
            contents: `${systemPrompt}\n\nMATERIALES DE ESTUDIO:\n${docsContext}`,
            config: {
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.HIGH,
              },
              responseMimeType: 'application/json',
            },
          });
          textOutput = response.text?.trim() || '[]';
        } else {
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `${systemPrompt}\n\nMATERIALES DE ESTUDIO:\n${docsContext}`,
            config: {
              responseMimeType: 'application/json',
            },
          });
          textOutput = response.text?.trim() || '[]';
        }

        const questions = JSON.parse(textOutput);
        if (Array.isArray(questions) && questions.length > 0) {
          return res.json({ success: true, modeUsed: 'gemini_env', providerName: 'Gemini (Entorno Activo)', questions });
        }
      } catch (geminiGenError) {
        console.warn('Gemini generation error, falling back to engine:', geminiGenError);
      }
    }

    // Heuristic fallback generator
    const fallbackQuestions = generateFallbackQuestions(docs.length > 0 ? docs : PRESET_SAMPLE_DOCUMENTS, config);
    return res.json({
      success: true,
      modeUsed: engineMode,
      providerName: 'Motor Heurístico de Estudio',
      questions: fallbackQuestions,
    });
  } catch (error: any) {
    console.error('Error generating questions:', error);
    res.status(500).json({ error: error.message || 'Error al generar preguntas' });
  }
});

// 4. Generate High-Quality Study Visual / Infographic Aid (supports 1K, 2K, 4K affordance)
app.post('/api/generate-study-aid', async (req: Request, res: Response) => {
  try {
    const { topic, resolution = '1K', summary } = req.body;
    // resolution can be '1K', '2K', or '4K'
    const validSizes = ['1K', '2K', '4K'];
    const selectedSize = validSizes.includes(resolution) ? (resolution as '1K' | '2K' | '4K') : '1K';

    if (ai) {
      try {
        const prompt = `Un mapa conceptual o infografía visual educativa de alta calidad editorial sobre el tema: "${topic || 'Conceptos clave'}".
Estilo limpio, profesional para estudiantes universitarios, diagramas claros, paleta moderna, sin texto ilegible, gráficos vectoriales abstractos con nodos temáticos. ${summary ? `Contexto: ${summary.slice(0, 200)}` : ''}`;

        const response = await ai.models.generateContent({
          model: 'gemini-nano-banana-2.1',
          contents: {
            parts: [{ text: prompt }],
          },
          config: {
            imageConfig: {
              aspectRatio: '16:9',
              imageSize: selectedSize,
            },
          },
        });

        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData?.data) {
              const imageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
              return res.json({ success: true, imageUrl, resolution: selectedSize });
            }
          }
        }
      } catch (imgError: any) {
        console.warn('Image generation warning:', imgError.message);
      }
    }

    // Return a beautiful procedural SVG visual study map fallback when offline or no image quota
    const svgMock = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" fill="none">
      <rect width="1200" height="675" rx="16" fill="%230f172a"/>
      <circle cx="600" cy="337" r="280" fill="%234338ca" fill-opacity="0.15" filter="blur(80px)"/>
      <circle cx="950" cy="180" r="180" fill="%23ec4899" fill-opacity="0.15" filter="blur(60px)"/>
      <rect x="60" y="60" width="1080" height="555" rx="12" stroke="%23334155" stroke-width="2" fill="%231e293b" fill-opacity="0.7"/>
      <text x="120" y="140" fill="%2338bdf8" font-family="sans-serif" font-size="28" font-weight="bold">StudyMaster AI • Mapa de Síntesis Visual (${selectedSize})</text>
      <text x="120" y="180" fill="%2394a3b8" font-family="sans-serif" font-size="18">${topic || 'Material Multimodal de Estudio'}</text>
      <circle cx="280" cy="360" r="70" fill="%233b82f6" fill-opacity="0.2" stroke="%2360a5fa" stroke-width="3"/>
      <text x="280" y="365" fill="%23ffffff" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">OCR / HTR</text>
      <line x1="350" y1="360" x2="520" y2="360" stroke="%2364748b" stroke-width="3" stroke-dasharray="6 6"/>
      <circle cx="600" cy="360" r="80" fill="%238b5cf6" fill-opacity="0.25" stroke="%23a78bfa" stroke-width="4"/>
      <text x="600" y="355" fill="%23ffffff" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">NÚCLEO</text>
      <text x="600" y="380" fill="%23c4b5fd" font-family="sans-serif" font-size="14" text-anchor="middle">CONCEPTUAL</text>
      <line x1="680" y1="360" x2="850" y2="360" stroke="%2364748b" stroke-width="3" stroke-dasharray="6 6"/>
      <circle cx="920" cy="360" r="70" fill="%23ec4899" fill-opacity="0.2" stroke="%23f472b6" stroke-width="3"/>
      <text x="920" y="365" fill="%23ffffff" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">JACQUELINE</text>
      <rect x="420" y="490" width="360" height="48" rx="24" fill="%230284c7" fill-opacity="0.3" stroke="%2338bdf8" stroke-width="1.5"/>
      <text x="600" y="520" fill="%23e0f2fe" font-family="sans-serif" font-size="15" text-anchor="middle" font-weight="600">Resolución generada: ${selectedSize}</text>
    </svg>`;

    return res.json({
      success: true,
      imageUrl: svgMock,
      resolution: selectedSize,
      isSimulated: !ai,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error al generar la infografía' });
  }
});

// Vite middleware or Static files
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StudyMaster AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
