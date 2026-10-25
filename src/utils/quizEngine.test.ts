import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleModalitySelection,
  normalizeText,
  evaluateMechanicA,
  assessSemanticSimilarity,
  calculateQuizSummary,
  generateFallbackQuestions,
  sanitizeAndValidateQuestions,
  stripQuestionBoilerplate,
  resetGenerationHistoryForTesting,
  fixSpanishContractionsAndGrammar,
  resolveAnaphoricSubject,
  normalizeStudyNotesLine,
  validateQuestionQualityGate,
  PRESET_SAMPLE_DOCUMENTS,
} from './quizEngine';
import { buildLocalDocAnalysis, isBinaryGarbage, cleanExtractedText } from './documentParser';
import { selectBestFlashModelFromList } from '../services/geminiClient';
import { QuestionModality, Question, UserAnswer, QuizConfig, UploadedDoc, DifficultyLevel, DIFFICULTY_LABELS } from '../types';

test('Modality Selector: Enforces maximum of 3 modalities rule and minimum of 1', () => {
  let selected: QuestionModality[] = ['multiple_choice'];

  // Add 2nd
  let res = toggleModalitySelection(selected, 'true_false');
  assert.equal(res.isBlocked, false);
  assert.deepEqual(res.updated, ['multiple_choice', 'true_false']);
  selected = res.updated;

  // Add 3rd
  res = toggleModalitySelection(selected, 'fill_blank');
  assert.equal(res.isBlocked, false);
  assert.equal(res.canAddMore, false);
  assert.deepEqual(res.updated, ['multiple_choice', 'true_false', 'fill_blank']);
  selected = res.updated;

  // Try to add 4th: MUST BE BLOCKED
  res = toggleModalitySelection(selected, 'open_question');
  assert.equal(res.isBlocked, true);
  assert.equal(res.canAddMore, false);
  assert.deepEqual(res.updated, ['multiple_choice', 'true_false', 'fill_blank']);

  // Remove one
  res = toggleModalitySelection(selected, 'multiple_choice');
  assert.equal(res.isBlocked, false);
  assert.equal(res.canAddMore, true);
  assert.deepEqual(res.updated, ['true_false', 'fill_blank']);
  selected = res.updated;

  // Try to remove remaining until 1
  res = toggleModalitySelection(selected, 'true_false');
  selected = res.updated;
  assert.deepEqual(selected, ['fill_blank']);

  // Cannot remove the last one (must keep at least 1)
  res = toggleModalitySelection(selected, 'fill_blank');
  assert.deepEqual(res.updated, ['fill_blank']);
});

test('normalizeText handles accents, uppercase, punctuation and extra spaces', () => {
  assert.equal(normalizeText('  ¡Principio PRO-PERSONA!  '), 'principio propersona');
  assert.equal(normalizeText('RuBisCO, ¿carboxilasa-oxigenasa?'), 'rubisco carboxilasaoxigenasa');
});

test('Mechanic A: Instant validation for Multiple Choice and True/False', () => {
  const dummyQuestion: Question = {
    id: 'test-1',
    type: 'multiple_choice',
    difficulty: 'facil',
    prompt: '¿Es el cielo azul?',
    options: ['Sí', 'No'],
    correctAnswer: 'Sí',
    officialAnswer: 'Sí, por dispersión de Rayleigh.',
    explanation: 'Dispersión de luz solar.',
    sourceDocName: 'test.pdf'
  };

  assert.equal(evaluateMechanicA(dummyQuestion, 'Sí').isCorrect, true);
  assert.equal(evaluateMechanicA(dummyQuestion, 'sí').isCorrect, true);
  assert.equal(evaluateMechanicA(dummyQuestion, 'No').isCorrect, false);
});

test('Mechanic B: Semantic similarity assesses key concept tokens', () => {
  const official = 'El Caso Almonacid Arellano vs Chile obligo el control de convencionalidad ex officio';
  const goodUser = 'Se establecio en Almonacid Arellano el control ex officio de convencionalidad';
  const badUser = 'El derecho romano prescribe la prescripcion civil ordinaria';

  const goodEval = assessSemanticSimilarity(goodUser, official);
  assert.equal(goodEval.suggestedMatch, true);
  assert.ok(goodEval.similarityScore >= 0.5);
  assert.ok(goodEval.highlightedKeywords.length >= 3);

  const badEval = assessSemanticSimilarity(badUser, official);
  assert.equal(badEval.suggestedMatch, false);
  assert.ok(badEval.similarityScore < 0.3);
});

test('Quiz Summary & Jacqueline Master Badge calculation', () => {
  const dummyQuestions: Question[] = [
    {
      id: 'q1',
      type: 'multiple_choice',
      difficulty: 'jacqueline',
      prompt: 'Pregunta 1',
      correctAnswer: 'A',
      officialAnswer: 'A',
      explanation: '',
      sourceDocName: 'doc1.pdf'
    },
    {
      id: 'q2',
      type: 'true_false',
      difficulty: 'jacqueline',
      prompt: 'Pregunta 2',
      correctAnswer: 'Verdadero',
      officialAnswer: 'Verdadero',
      explanation: '',
      sourceDocName: 'doc1.pdf'
    },
    {
      id: 'q3',
      type: 'fill_blank',
      difficulty: 'jacqueline',
      prompt: 'Pregunta 3',
      correctAnswer: 'rubisco',
      officialAnswer: 'rubisco',
      explanation: '',
      sourceDocName: 'doc2.png'
    },
    {
      id: 'q4',
      type: 'open_question',
      difficulty: 'jacqueline',
      prompt: 'Pregunta 4',
      correctAnswer: 'respuesta',
      officialAnswer: 'respuesta',
      explanation: '',
      sourceDocName: 'doc2.png'
    },
    {
      id: 'q5',
      type: 'multiple_choice',
      difficulty: 'jacqueline',
      prompt: 'Pregunta 5',
      correctAnswer: 'B',
      officialAnswer: 'B',
      explanation: '',
      sourceDocName: 'doc1.pdf'
    }
  ];

  const answersPass: Record<string, UserAnswer> = {
    q1: { questionId: 'q1', isCorrect: true, answeredAt: Date.now() },
    q2: { questionId: 'q2', isCorrect: true, answeredAt: Date.now() },
    q3: { questionId: 'q3', isCorrect: true, answeredAt: Date.now() },
    q4: { questionId: 'q4', isCorrect: true, answeredAt: Date.now() },
    q5: { questionId: 'q5', isCorrect: false, answeredAt: Date.now() }
  };

  const summaryPass = calculateQuizSummary(dummyQuestions, answersPass, 'jacqueline', 120);
  assert.equal(summaryPass.totalQuestions, 5);
  assert.equal(summaryPass.correctAnswers, 4);
  assert.equal(summaryPass.scorePercentage, 80);
  assert.equal(summaryPass.isJacquelineMaster, true);

  const answersFail: Record<string, UserAnswer> = {
    q1: { questionId: 'q1', isCorrect: true, answeredAt: Date.now() },
    q2: { questionId: 'q2', isCorrect: true, answeredAt: Date.now() },
    q3: { questionId: 'q3', isCorrect: true, answeredAt: Date.now() },
    q4: { questionId: 'q4', isCorrect: false, answeredAt: Date.now() },
    q5: { questionId: 'q5', isCorrect: false, answeredAt: Date.now() }
  };
  const summaryFail = calculateQuizSummary(dummyQuestions, answersFail, 'jacqueline', 120);
  assert.equal(summaryFail.scorePercentage, 60);
  assert.equal(summaryFail.isJacquelineMaster, false);
});

test('Fallback Question Generator respects configuration modalities and count', () => {
  const config: QuizConfig = {
    selectedModalities: ['multiple_choice', 'fill_blank'],
    difficulty: 'jacqueline',
    questionCount: 6,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  };

  const generated = generateFallbackQuestions(PRESET_SAMPLE_DOCUMENTS, config);
  assert.equal(generated.length, 6);
  generated.forEach(q => {
    assert.ok(config.selectedModalities.includes(q.type), `Expected modality in selected list, got ${q.type}`);
    assert.equal(q.difficulty, 'jacqueline');
    assert.ok(q.prompt.length > 10);
    assert.ok(q.officialAnswer.length > 5);
  });
});

test('Document-Exclusive Generation: Custom uploaded document produces questions ONLY from that document', () => {
  const customDoc: UploadedDoc = {
    id: 'doc-custom-inca',
    name: 'Historia_Arquitectura_Inca_Cusco.txt',
    size: 1420,
    type: 'text/plain',
    extension: '.txt',
    category: 'other',
    rawText: `El Imperio del Tahuantinsuyo alcanzó su máxima expansión bajo el gobierno del emperador Pachacútec en el siglo XV.
La arquitectura incaica destaca por el uso de bloques de piedra finamente tallados que encajan con precisión milimétrica sin necesidad de argamasa.
La ciudadela de Machu Picchu fue edificada en la vertiente oriental de los Andes peruanos como centro administrativo y ceremonial.
El sistema contable y estadístico del imperio se registraba mediante cuerdas anudadas de colores denominadas Quipus.`,
    status: 'ready',
  };
  customDoc.analysis = buildLocalDocAnalysis(customDoc);

  const config: QuizConfig = {
    selectedModalities: ['multiple_choice', 'true_false', 'fill_blank'],
    difficulty: 'medio',
    questionCount: 6,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  };

  const questions = generateFallbackQuestions([customDoc], config);
  assert.equal(questions.length, 6);

  for (const q of questions) {
    // Must strictly cite the uploaded document name, NEVER sample biology/law/transformer docs
    assert.equal(q.sourceDocName, 'Historia_Arquitectura_Inca_Cusco.txt');
    assert.ok(!q.prompt.includes('Complejo II'));
    assert.ok(!q.prompt.includes('RuBisCO'));
    assert.ok(!q.prompt.includes('Almonacid'));
    assert.ok(!q.prompt.includes('Transformer'));
  }
});

test('Gemini Flash Model Selector skips deprecated gemini-2.5-flash and chooses valid Flash model', () => {
  const mockModelsFromApi = [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3-flash-preview', supportedGenerationMethods: ['generateContent'] },
  ];

  const chosen = selectBestFlashModelFromList(mockModelsFromApi);
  assert.notEqual(chosen, 'gemini-2.5-flash');
  assert.equal(chosen, 'gemini-3-flash-preview');
});

test('Document Parser detects binary garbage vs clean text', () => {
  assert.equal(isBinaryGarbage('%PDF-1.7\n\x00\x01\x02\x03'), true);
  assert.equal(isBinaryGarbage('PK\x03\x04\x14\x00\x06\x00'), true);
  assert.equal(isBinaryGarbage('La fotosíntesis oxigénica ocurre en los tilacoides del cloroplasto.'), false);
  assert.equal(cleanExtractedText('Hola\r\n\r\n\r\nMundo   Prueba'), 'Hola\n\nMundo Prueba');
});

test('Modo Estudio Sin IA: Rejects corrupted PDF CMap tokens and page headers from questions and options', () => {
  // Exact corrupted header string reported by user in screenshot
  const corruptedHeaderAndText = `R :AP sicodiagnósticoAyAEntM eNista P ageA 1 AofA C5.
El proceso psicodiagnóstico clínico constituye una instancia de evaluación psicológica integral mediante entrevistas semidirigidas y técnicas proyectivas.
La entrevista inicial permite establecer el encuadre terapéutico, formular hipótesis diagnósticas y evaluar los mecanismos de defensa del paciente.`;

  const cleaned = cleanExtractedText(corruptedHeaderAndText);
  assert.ok(!cleaned.includes('sicodiagnósticoAyAEntM'), `Cleaned text should not contain sicodiagnósticoAyAEntM, got: ${cleaned}`);
  assert.ok(!cleaned.includes('ageA'), `Cleaned text should not contain ageA, got: ${cleaned}`);
  assert.ok(!cleaned.includes('AofA'), `Cleaned text should not contain AofA, got: ${cleaned}`);
  assert.ok(!cleaned.includes('C5'), `Cleaned text should not contain C5, got: ${cleaned}`);

  const doc: UploadedDoc = {
    id: 'doc-psico-1',
    name: 'Resumen para el oral Psicodiagnóstico y Entrevista (1).pdf',
    size: 45200,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: corruptedHeaderAndText,
    status: 'ready',
  };
  doc.analysis = buildLocalDocAnalysis(doc);

  const config: QuizConfig = {
    selectedModalities: ['multiple_choice', 'true_false', 'fill_blank'],
    difficulty: 'jacqueline',
    questionCount: 6,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  };

  const questions = generateFallbackQuestions([doc], config);
  assert.equal(questions.length, 6);

  for (const q of questions) {
    assert.equal(q.sourceDocName, 'Resumen para el oral Psicodiagnóstico y Entrevista (1).pdf');
    assert.ok(!q.prompt.includes('sicodiagnósticoAyAEntM'), `Corrupted token in prompt: ${q.prompt}`);
    assert.ok(!q.prompt.includes('ageA'), `Corrupted token ageA in prompt: ${q.prompt}`);
    assert.ok(!q.prompt.includes('AofA'), `Corrupted token AofA in prompt: ${q.prompt}`);
    assert.ok(!q.prompt.includes('eNista'), `Corrupted token eNista in prompt: ${q.prompt}`);
    assert.ok(!q.correctAnswer.includes('sicodiagnósticoAyAEntM'));
    assert.ok(!q.correctAnswer.includes('ageA'));

    if (q.options) {
      for (const opt of q.options) {
        assert.ok(!opt.includes('sicodiagnósticoAyAEntM'), `Corrupted option: ${opt}`);
        assert.ok(!opt.includes('ageA'), `Corrupted option: ${opt}`);
        assert.ok(!opt.includes('eNista'), `Corrupted option: ${opt}`);
        assert.ok(!opt.includes('Ninguno de los conceptos citados'), `Meta fallback option should not be used: ${opt}`);
      }
    }
  }
});

test('Modo Estudio Sin IA: Even if a PDF only had a corrupted header line, synthesizes clean academic questions', () => {
  const onlyCorruptedHeader = `R :AP sicodiagnósticoAyAEntM eNista P ageA 1 AofA C5.`;

  const doc: UploadedDoc = {
    id: 'doc-psico-header-only',
    name: 'Resumen para el oral Psicodiagnóstico y Entrevista (1).pdf',
    size: 21000,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: onlyCorruptedHeader,
    status: 'ready',
  };
  doc.analysis = buildLocalDocAnalysis(doc);

  const config: QuizConfig = {
    selectedModalities: ['multiple_choice'],
    difficulty: 'jacqueline',
    questionCount: 4,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  };

  const questions = generateFallbackQuestions([doc], config);
  assert.equal(questions.length, 4);
  for (const q of questions) {
    assert.ok(!q.prompt.includes('sicodiagnósticoAyAEntM'), `Prompt must be clean: ${q.prompt}`);
    assert.ok(!q.prompt.includes('ageA'), `Prompt must be clean: ${q.prompt}`);
    assert.ok(!q.prompt.includes('AofA'), `Prompt must be clean: ${q.prompt}`);
    assert.ok(q.prompt.includes('Psicodiagnóstico') || q.prompt.includes('Entrevista'));
    assert.ok(q.topicTitle && q.topicTitle.length > 3, `Expected topicTitle on question, got: ${q.topicTitle}`);
    assert.equal(q.options?.length, 4);
  }
});

test('Subset font cipher repair fixes esumenApaMaAelAoMal and sicodiagnósticoAyAEntM eNista', () => {
  const rawCorrupted = 'esumenApaMaAelAoMal sicodiagnósticoAyAEntM eNista P ageA 1 AofA C5';
  const repaired = cleanExtractedText(rawCorrupted);
  assert.ok(!repaired.includes('esumenApaMaAelAoMal'), `Should repair esumenApaMaAelAoMal, got: ${repaired}`);
  assert.ok(!repaired.includes('sicodiagnósticoAyAEntM'), `Should repair sicodiagnósticoAyAEntM, got: ${repaired}`);
});

test('All 4 difficulties and all 4 modalities produce coherent questions with topicTitle', () => {
  const difficulties: DifficultyLevel[] = ['facil', 'medio', 'dificil', 'jacqueline'];
  const modalities: QuestionModality[] = ['multiple_choice', 'true_false', 'fill_blank', 'open_question'];

  const customDoc: UploadedDoc = {
    id: 'doc-psicodiagnostico-completo',
    name: 'Resumen para el oral Psicodiagnóstico y Entrevista.pdf',
    size: 38400,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: `1. Encuadre y Entrevista Inicial
El proceso psicodiagnóstico clínico se inicia con la entrevista semidirigida, cuyo objetivo principal es comprender la demanda del sujeto y establecer el encuadre de trabajo.
2. Mecanismos de Defensa y Transferencia
Durante la administración de técnicas proyectivas y psicométricas, el profesional evalúa la fortaleza yoica, los mecanismos de defensa predominantes y la modalidad vincular transferencial.
3. Informe Psicológico y Devolución Diagnóstica
La entrevista de devolución oral consiste en comunicar al examinado una síntesis integrada de sus recursos adaptativos y áreas de conflicto, adaptando el lenguaje técnico al nivel de comprensión del paciente.`,
    status: 'ready',
  };
  customDoc.analysis = buildLocalDocAnalysis(customDoc);

  for (const difficulty of difficulties) {
    for (const modality of modalities) {
      const config: QuizConfig = {
        selectedModalities: [modality],
        difficulty,
        questionCount: 3,
        includeDocCrossAnalysis: true,
        engineMode: 'no_ai',
      };

      const questions = generateFallbackQuestions([customDoc], config);
      assert.equal(questions.length, 3, `Expected 3 questions for ${difficulty} / ${modality}`);

      for (const q of questions) {
        assert.equal(q.type, modality);
        assert.equal(q.difficulty, difficulty);
        assert.ok(q.topicTitle && q.topicTitle.trim().length >= 4, `Missing topicTitle for ${difficulty}/${modality}`);
        assert.ok(!q.topicTitle.includes('Fragmento #'), `topicTitle should not be Fragmento #: ${q.topicTitle}`);
        assert.ok(q.prompt.length > 25, `Prompt too short: ${q.prompt}`);
        assert.ok(q.correctAnswer.length >= 2, `Missing correctAnswer: ${q.correctAnswer}`);
        assert.ok(q.officialAnswer.length >= 10, `Missing officialAnswer: ${q.officialAnswer}`);
      }
    }
  }
});

test('sanitizeAndValidateQuestions replaces corrupted AI questions in IA del entorno del creador mode', () => {
  const doc: UploadedDoc = {
    id: 'doc-creator-env',
    name: 'Resumen para el oral Psicodiagnóstico y Entrevista (1).pdf',
    size: 25000,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: 'El psicodiagnóstico clínico articula la entrevista inicial, la batería de tests proyectivos y la devolución diagnóstica final.',
    status: 'ready',
  };
  doc.analysis = buildLocalDocAnalysis(doc);

  const config: QuizConfig = {
    selectedModalities: ['multiple_choice'],
    difficulty: 'medio',
    questionCount: 2,
    includeDocCrossAnalysis: true,
    engineMode: 'gemini_env',
  };

  const badAiQuestions: Question[] = [
    {
      id: 'bad-ai-1',
      type: 'multiple_choice',
      difficulty: 'medio',
      prompt: 'Según el documento, ¿qué término completa el enunciado: «R [ _____ ] :AP sicodiagnósticoAyAEntM eNista P ageA 1 AofA C5.»?',
      options: ['sicodiagnósticoAyAEntM', 'ageA', 'esumenApaMaAelAoMal', 'Ninguno de los conceptos citados'],
      correctAnswer: 'sicodiagnósticoAyAEntM',
      officialAnswer: 'R :AP sicodiagnósticoAyAEntM eNista P ageA 1 AofA C5.',
      explanation: 'Cita textual.',
      sourceDocName: doc.name,
    },
  ];

  const validated = sanitizeAndValidateQuestions(badAiQuestions, [doc], config);
  assert.equal(validated.length, 2);
  for (const q of validated) {
    assert.ok(!q.prompt.includes('sicodiagnósticoAyAEntM'), `Sanitized prompt still corrupted: ${q.prompt}`);
    assert.ok(!q.prompt.includes('esumenApaMaAelAoMal'), `Sanitized prompt still corrupted: ${q.prompt}`);
    assert.ok(q.topicTitle && q.topicTitle.length > 3, `Sanitized question must have topicTitle: ${q.topicTitle}`);
  }
});

test('Multi-line wrapped PDF sentences and valid Spanish 4-consonant words are preserved intact without mid-word truncation', () => {
  const wrappedPdfText = `1. Encuadre Clínico y Entrevista Inicial
El proceso psicodiagnóstico clínico se inicia con la entrevista semidirigida para evaluar la demanda del
paciente y establecer la construcción del encuadre terapéutico como instrumento de perspectiva clínica.`;

  const cleaned = cleanExtractedText(wrappedPdfText);
  // Must preserve "construcción", "instrumento", "perspectiva" and join the wrapped line into a single complete sentence
  assert.ok(cleaned.includes('demanda del paciente y establecer la construcción del encuadre terapéutico como instrumento de perspectiva clínica.'));

  const doc: UploadedDoc = {
    id: 'doc-wrapped-pdf',
    name: 'Resumen_Psicodiagnostico_y_Entrevista.pdf',
    size: 32000,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: wrappedPdfText,
    status: 'ready',
  };
  doc.analysis = buildLocalDocAnalysis(doc);

  const questions = generateFallbackQuestions([doc], {
    selectedModalities: ['multiple_choice', 'true_false', 'fill_blank', 'open_question'],
    difficulty: 'jacqueline',
    questionCount: 4,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  });

  assert.equal(questions.length, 4);
  for (const q of questions) {
    assert.ok(!q.prompt.includes('demanda del pa.'), `Sentence was truncated mid-word: ${q.prompt}`);
    assert.ok(q.topicTitle?.includes('Encuadre Clínico y Entrevista Inicial'), `Expected heading topicTitle, got: ${q.topicTitle}`);
    assert.ok(q.specificTopic && q.specificTopic.length >= 4, `Expected specificTopic on question, got: ${q.specificTopic}`);
    if (q.type === 'multiple_choice') {
      assert.equal(q.options?.length, 4);
      // Every option in multiple_choice must be a complete conceptual statement (>= 4 words), never a single isolated verb like "Establecer"
      for (const opt of q.options || []) {
        assert.ok(opt.split(/\s+/).length >= 4, `Expected full proposition option in multiple_choice, got: "${opt}"`);
      }
    }
  }
});

test('stripQuestionBoilerplate removes section/book/manual/page prefixes and goes straight to the clean question', () => {
  const noisy1 = 'En la sección 3.2 del libro del manual, pág. 14 y 15, ¿cuál es el objetivo principal de la entrevista semidirigida?';
  assert.equal(
    stripQuestionBoilerplate(noisy1),
    '¿Cuál es el objetivo principal de la entrevista semidirigida?'
  );

  const noisy2 = 'Según el apartado «Encuadre Clínico» del documento "Resumen.pdf" (pág. 8), la entrevista inicial permite establecer el encuadre terapéutico.';
  assert.equal(
    stripQuestionBoilerplate(noisy2),
    'La entrevista inicial permite establecer el encuadre terapéutico.'
  );

  const noisy3 = 'De acuerdo con el capítulo 4 del manual de derecho constitucional (pp. 22-24), ¿qué establece el principio pro persona?';
  assert.equal(
    stripQuestionBoilerplate(noisy3),
    '¿Qué establece el principio pro persona?'
  );
});

test('Every question in all 4 modalities and all modes has both topicTitle and specificTopic and ZERO section/page/manual boilerplate', () => {
  const doc: UploadedDoc = {
    id: 'doc-neuro-1',
    name: 'Neurofisiologia_Sinapsis_y_Neurotransmisores.pdf',
    size: 42000,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: `1. Transmisión Sináptica Química
La liberación de neurotransmisores en la hendidura sináptica depende de la entrada de iones de calcio a través de canales dependientes de voltaje en el botón terminal.
2. Potenciales Postsinápticos Excitatorios e Inhibitorios
El glutamato actúa como el principal neurotransmisor excitatorio del sistema nervioso central al despolarizar la membrana postsináptica mediante receptores AMPA y NMDA.
El ácido gamma-aminobutírico (GABA) induce hiperpolarización neuronal al incrementar la permeabilidad selectiva a los iones de cloro.`,
    status: 'ready',
  };
  doc.analysis = buildLocalDocAnalysis(doc);

  const modalities: QuestionModality[] = ['multiple_choice', 'true_false', 'fill_blank', 'open_question'];
  for (const mod of modalities) {
    const questions = generateFallbackQuestions([doc], {
      selectedModalities: [mod],
      difficulty: 'medio',
      questionCount: 3,
      includeDocCrossAnalysis: true,
      engineMode: 'no_ai',
    });

    for (const q of questions) {
      assert.ok(q.topicTitle && q.topicTitle.length >= 4, `Missing topicTitle on ${mod}`);
      assert.ok(q.specificTopic && q.specificTopic.length >= 4, `Missing specificTopic on ${mod}`);
      assert.notEqual(
        normalizeText(q.topicTitle),
        normalizeText(q.specificTopic),
        `topicTitle (${q.topicTitle}) and specificTopic (${q.specificTopic}) must be distinct`
      );
      assert.ok(!/\b(?:en la secci[óo]n|del manual|p[áa]g\.?\s*\d+|seg[úu]n el documento|de acuerdo con el documento)\b/i.test(q.prompt), `Boilerplate found in prompt: ${q.prompt}`);
      for (const opt of q.options || []) {
        assert.ok(!/\b(?:en la secci[óo]n|del manual|p[áa]g\.?\s*\d+|seg[úu]n el apartado|en relaci[óo]n con «)\b/i.test(opt), `Boilerplate found in option: ${opt}`);
      }
    }
  }

  // Also verify sanitizeAndValidateQuestions strips AI-generated boilerplate and populates specificTopic
  const aiRawWithBoilerplate = [
    {
      id: 'ai-1',
      type: 'multiple_choice',
      difficulty: 'dificil',
      topicTitle: 'Transmisión Sináptica Química',
      specificTopic: 'Canales de calcio dependientes de voltaje',
      prompt: 'En la sección 1 del libro del manual, pág 12 y 13, ¿qué ión desencadena la exocitosis de vesículas sinápticas en el botón terminal?',
      options: [
        'En la sección 1 del manual, la entrada de iones de calcio (Ca2+) a través de canales dependientes de voltaje',
        'La salida pasiva de iones de potasio (K+) hacia el espacio extracelular',
        'El bloqueo de receptores postsinápticos por magnesio',
        'La degradación enzimática de acetilcolina en el soma'
      ],
      correctAnswer: 'En la sección 1 del manual, la entrada de iones de calcio (Ca2+) a través de canales dependientes de voltaje',
      officialAnswer: 'La entrada de calcio por canales dependientes de voltaje activa la fusión vesicular.',
      explanation: 'El influjo de Ca2+ es el disparador directo de la exocitosis de neurotransmisores.',
      sourceDocName: doc.name,
    }
  ];

  const sanitized = sanitizeAndValidateQuestions(aiRawWithBoilerplate, [doc], {
    selectedModalities: ['multiple_choice'],
    difficulty: 'dificil',
    questionCount: 1,
    includeDocCrossAnalysis: true,
    engineMode: 'gemini_visitor',
  });

  assert.equal(sanitized.length, 1);
  assert.equal(
    sanitized[0].prompt,
    '¿Qué ión desencadena la exocitosis de vesículas sinápticas en el botón terminal?'
  );
  assert.equal(sanitized[0].topicTitle, 'Transmisión Sináptica Química');
  assert.equal(sanitized[0].specificTopic, 'Canales de calcio dependientes de voltaje');
  assert.ok(!sanitized[0].correctAnswer.toLowerCase().includes('en la sección 1'));
});

test('Difficulty label for "dificil" is strictly "Difícil (POVEDA)"', () => {
  assert.equal(DIFFICULTY_LABELS.facil, 'Fácil');
  assert.equal(DIFFICULTY_LABELS.medio, 'Medio');
  assert.equal(DIFFICULTY_LABELS.dificil, 'Difícil (POVEDA)');
  assert.equal(DIFFICULTY_LABELS.jacqueline, 'Jacqueline');
});

test('Regenerating quizzes in Demo Sin IA produces DIFFERENT questions and covers diverse themes across the entire document', () => {
  resetGenerationHistoryForTesting();

  const multiSectionDoc: UploadedDoc = {
    id: 'doc-multi-themes',
    name: 'Manual_Integral_Fisiologia_y_Clinica.pdf',
    size: 64000,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: `1. Fisiología Cardiovascular y Gasto Cardíaco
El gasto cardíaco representa el volumen total de sangre eyectado por el ventrículo izquierdo hacia la arteria aorta en cada minuto para garantizar la perfusión tisular.
La ley de Frank-Starling establece que la fuerza de contracción ventricular se incrementa en proporción directa al estiramiento diastólico de las fibras miocárdicas.
2. Filtración Glomerular y Función Renal
La tasa de filtración glomerular depende de la presión hidrostática capilar frente a la presión oncótica plasmática dentro de la cápsula de Bowman.
El sistema renina-angiotensina-aldosterona regula la presión arterial sistémica mediante la vasoconstricción arteriolar y la reabsorción tubular de sodio.
3. Eje Hipotálamo-Hipófisis-Adrenal
El cortisol endógeno se secreta en la corteza suprarrenal bajo el estímulo de la hormona adrenocorticotropa para modular el metabolismo glucídico y la respuesta al estrés.
4. Neurotransmisión Colinérgica en la Placa Motora
La acetilcolina liberada en la unión neuromuscular activa receptores nicotínicos ionotrópicos para desencadenar el potencial de placa terminal y la contracción muscular.`,
    status: 'ready',
  };
  multiSectionDoc.analysis = buildLocalDocAnalysis(multiSectionDoc);

  const config: QuizConfig = {
    selectedModalities: ['multiple_choice', 'true_false'],
    difficulty: 'medio',
    questionCount: 4,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  };

  const run1 = generateFallbackQuestions([multiSectionDoc], config);
  const run2 = generateFallbackQuestions([multiSectionDoc], config);
  const run3 = generateFallbackQuestions([multiSectionDoc], config);

  assert.equal(run1.length, 4);
  assert.equal(run2.length, 4);
  assert.equal(run3.length, 4);

  // 1. Within Run 1, questions must span at least 3 distinct main topics (`topicTitle`) across the document
  const run1Topics = new Set(run1.map(q => q.topicTitle));
  assert.ok(
    run1Topics.size >= 3,
    `Expected questions in Run 1 to cover at least 3 distinct themes across the document, got ${run1Topics.size}: ${Array.from(run1Topics).join(', ')}`
  );

  // 2. Regenerating (Run 2 vs Run 1, and Run 3 vs Run 2) must produce DIFFERENT question prompts, never the exact same set
  const run1Prompts = new Set(run1.map(q => normalizeText(q.prompt)));
  const run2Prompts = new Set(run2.map(q => normalizeText(q.prompt)));
  const run3Prompts = new Set(run3.map(q => normalizeText(q.prompt)));

  let newQuestionsInRun2 = 0;
  for (const p of run2Prompts) {
    if (!run1Prompts.has(p)) newQuestionsInRun2++;
  }
  assert.ok(
    newQuestionsInRun2 >= 3,
    `Expected regenerating quiz (Run 2) to produce mostly new questions compared to Run 1, but only ${newQuestionsInRun2}/4 were new`
  );

  let newQuestionsInRun3 = 0;
  for (const p of run3Prompts) {
    if (!run2Prompts.has(p)) newQuestionsInRun3++;
  }
  assert.ok(
    newQuestionsInRun3 >= 3,
    `Expected regenerating quiz (Run 3) to produce mostly new questions compared to Run 2, but only ${newQuestionsInRun3}/4 were new`
  );
});

test('Difícil (POVEDA) and Jacqueline (plus Fácil and Medio) produce genuinely distinct questions and structures, NEVER a carbon copy ("calco")', () => {
  resetGenerationHistoryForTesting();

  const studyDoc: UploadedDoc = {
    id: 'doc-diff-contrast',
    name: 'Tratado_Psicodiagnostico_y_Evaluacion.pdf',
    size: 51000,
    type: 'application/pdf',
    extension: '.pdf',
    category: 'pdf',
    rawText: `1. Encuadre Clínico y Entrevista Inicial
El proceso psicodiagnóstico clínico se inicia con la entrevista semidirigida para comprender la demanda del sujeto y establecer el encuadre de trabajo.
2. Mecanismos de Defensa y Transferencia
Durante la administración de técnicas proyectivas, el psicólogo clínico evalúa la fortaleza yoica, los mecanismos de defensa predominantes y la modalidad vincular transferencial.
3. Devolución Diagnóstica e Informe
La entrevista de devolución oral consiste en comunicar al examinado una síntesis integrada de sus recursos adaptativos y áreas de conflicto mediante un lenguaje claro.`,
    status: 'ready',
  };
  studyDoc.analysis = buildLocalDocAnalysis(studyDoc);

  const modalities: QuestionModality[] = ['multiple_choice', 'true_false', 'fill_blank', 'open_question'];

  const facilQuestions = generateFallbackQuestions([studyDoc], {
    selectedModalities: modalities,
    difficulty: 'facil',
    questionCount: 4,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  });

  const medioQuestions = generateFallbackQuestions([studyDoc], {
    selectedModalities: modalities,
    difficulty: 'medio',
    questionCount: 4,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  });

  const povedaQuestions = generateFallbackQuestions([studyDoc], {
    selectedModalities: modalities,
    difficulty: 'dificil',
    questionCount: 4,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  });

  const jacquelineQuestions = generateFallbackQuestions([studyDoc], {
    selectedModalities: modalities,
    difficulty: 'jacqueline',
    questionCount: 4,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  });

  // Verify zero prompt overlap between Difícil (POVEDA) and Jacqueline
  const povedaPrompts = new Set(povedaQuestions.map(q => normalizeText(q.prompt)));
  const jacqPrompts = new Set(jacquelineQuestions.map(q => normalizeText(q.prompt)));

  for (const jp of jacqPrompts) {
    assert.ok(
      !povedaPrompts.has(jp),
      `Jacqueline prompt must NOT be identical to Difícil (POVEDA) prompt: "${jp}"`
    );
  }

  // Verify zero prompt overlap across all 4 difficulties for Multiple Choice and True/False
  const allPromptsByDiff = [
    facilQuestions.map(q => normalizeText(q.prompt)),
    medioQuestions.map(q => normalizeText(q.prompt)),
    povedaQuestions.map(q => normalizeText(q.prompt)),
    jacquelineQuestions.map(q => normalizeText(q.prompt)),
  ];

  for (let d1 = 0; d1 < allPromptsByDiff.length; d1++) {
    for (let d2 = d1 + 1; d2 < allPromptsByDiff.length; d2++) {
      const set1 = new Set(allPromptsByDiff[d1]);
      for (const p2 of allPromptsByDiff[d2]) {
        assert.ok(
          !set1.has(p2),
          `Difficulty ${d1} and Difficulty ${d2} generated an identical prompt: "${p2}"`
        );
      }
    }
  }
});

test('Spanish grammar, contractions (al/del), no ellipsis, and anaphoric context resolution ("este periodo", "esta obra", "además")', () => {
  assert.equal(
    fixSpanishContractionsAndGrammar('Se aplica a el paciente de el encuadre...'),
    'Se aplica al paciente del encuadre'
  );

  const resolvedPeriodo = resolveAnaphoricSubject(
    'Este periodo se caracteriza por la evaluación diagnóstica integral mediante entrevistas clínicas.',
    'Psicodiagnóstico Clínico Inicial'
  );
  assert.ok(resolvedPeriodo.includes('«Psicodiagnóstico Clínico Inicial»'), `Expected explicit context for 'Este periodo', got: ${resolvedPeriodo}`);
  assert.ok(!/^Este periodo\b/i.test(resolvedPeriodo));

  const resolvedObra = resolveAnaphoricSubject(
    'Esta obra establece los fundamentos técnicos de la entrevista operativa centrada en el consultante.',
    'Teoría de la Entrevista de Bleger'
  );
  assert.ok(resolvedObra.includes('«Teoría de la Entrevista de Bleger»'));

  const resolvedAdemas = resolveAnaphoricSubject(
    'Además, permite identificar las defensas predominantes frente a la ansiedad paranoide.',
    'Administración de Técnicas Proyectivas'
  );
  assert.ok(resolvedAdemas.includes('«Administración de Técnicas Proyectivas»'));
});

test('Psychology Oral Summary format ("Resumen para el oral Psicodiagnóstico y Entrevista"): handles (pág. X), Concepto: autores (año), Autor (país): idea, and parenthetical citations without asking years or pages', () => {
  resetGenerationHistoryForTesting();

  const psicodiagnosticoNotes = `Resumen para el oral Psicodiagnóstico y Entrevista (pág. 1)
1. Concepto y Encuadre de la Entrevista Psicológica (pág. 4)
Bleger (Argentina): La entrevista psicológica configura un campo dinámico donde interactúan transferencia y contratransferencia entre entrevistador y consultante.
Encuadre clínico: Bleger y Ocampo (1971) - mantenimiento constante de las variables de tiempo, lugar y rol técnico durante el proceso psicodiagnóstico.
Entrevista semidirigida: Siquier de Ocampo (1974)
Este proceso permite formular hipótesis diagnósticas presuntivas a partir de los observables clínicos y el discurso libre del sujeto (Sternberg, 1998).
2. Técnicas Proyectivas y Devolución de Información (pág. 12)
Aberastury (Argentina): El juego diagnóstico infantil constituye la vía regia de acceso al mundo interno y las fantasías inconscientes de enfermedad y curación.
Devolución diagnóstica: comunicación verbal discriminada y dosificada de los resultados del psicodiagnóstico para favorecer la insight del paciente (pág. 18).`;

  const pastedDoc: UploadedDoc = {
    id: 'doc-txt-psico',
    name: 'Resumen para el oral Psicodiagnóstico y Entrevista',
    size: psicodiagnosticoNotes.length,
    type: 'text/plain',
    extension: '.txt',
    category: 'text',
    rawText: psicodiagnosticoNotes,
    selected: true,
    status: 'ready',
  };
  pastedDoc.analysis = buildLocalDocAnalysis(pastedDoc);

  const difficulties: DifficultyLevel[] = ['facil', 'medio', 'dificil', 'jacqueline'];
  const modalities: QuestionModality[] = ['multiple_choice', 'true_false', 'fill_blank', 'open_question'];

  for (const diff of difficulties) {
    const questions = generateFallbackQuestions([pastedDoc], {
      selectedModalities: modalities,
      difficulty: diff,
      questionCount: 6,
      includeDocCrossAnalysis: true,
      engineMode: 'no_ai',
    });

    assert.equal(questions.length, 6);
    for (const q of questions) {
      assert.equal(
        validateQuestionQualityGate(q).valid,
        true,
        `Question failed quality gate in ${diff}/${q.type}: ${JSON.stringify(q)}`
      );
      // Must NEVER contain ellipsis, page numbers, or citation years as answers
      assert.ok(!q.prompt.includes('…') && !q.prompt.includes('...'), `Ellipsis in prompt: ${q.prompt}`);
      assert.ok(!/\bp[áa]g\.?\s*\d+/i.test(q.prompt), `Page number in prompt: ${q.prompt}`);
      assert.ok(!/^\d{4}$/.test(q.correctAnswer.trim()), `Citation year used as answer: ${q.correctAnswer}`);
      // Explanation must include exact quote and source
      assert.ok(q.explanation.includes('Cita exacta de los apuntes:'), `Missing exact quote in explanation: ${q.explanation}`);
      assert.ok(q.explanation.includes('Fuente:'), `Missing source line in explanation: ${q.explanation}`);
    }
  }
});

test('Document selection filter: Deselected documents (selected: false) are excluded from quiz generation', () => {
  const docSelected: UploadedDoc = {
    id: 'doc-sel-1',
    name: 'Apuntes_Seleccionados_Cardiologia.txt',
    size: 500,
    type: 'text/plain',
    extension: '.txt',
    category: 'text',
    rawText: '1. Ciclo Cardíaco\nLa sístole ventricular impulsa la sangre oxigenada hacia la circulación sistémica mediante la apertura de la válvula aórtica.',
    selected: true,
    status: 'ready',
  };
  docSelected.analysis = buildLocalDocAnalysis(docSelected);

  const docUnselected: UploadedDoc = {
    id: 'doc-unsel-2',
    name: 'Apuntes_Excluidos_Botanica.txt',
    size: 500,
    type: 'text/plain',
    extension: '.txt',
    category: 'text',
    rawText: '1. Fotosíntesis Vegetal\nEl cloroplasto captura fotones solares mediante los pigmentos de clorofila ubicados en la membrana tilacoidal.',
    selected: false,
    status: 'ready',
  };
  docUnselected.analysis = buildLocalDocAnalysis(docUnselected);

  const questions = generateFallbackQuestions([docSelected, docUnselected], {
    selectedModalities: ['multiple_choice', 'true_false'],
    difficulty: 'facil',
    questionCount: 4,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai',
  });

  assert.equal(questions.length, 4);
  for (const q of questions) {
    assert.equal(q.sourceDocName, 'Apuntes_Seleccionados_Cardiologia.txt');
    assert.ok(!q.prompt.toLowerCase().includes('cloroplasto'));
  }
});


