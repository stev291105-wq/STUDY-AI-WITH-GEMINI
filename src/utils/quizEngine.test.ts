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
  PRESET_SAMPLE_DOCUMENTS,
} from './quizEngine';
import { buildLocalDocAnalysis, isBinaryGarbage, cleanExtractedText } from './documentParser';
import { selectBestFlashModelFromList } from '../services/geminiClient';
import { QuestionModality, Question, UserAnswer, QuizConfig, UploadedDoc, DifficultyLevel } from '../types';

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
    if (q.type === 'multiple_choice') {
      assert.equal(q.options?.length, 4);
      // Every option in multiple_choice must be a complete conceptual statement (>= 4 words), never a single isolated verb like "Establecer"
      for (const opt of q.options || []) {
        assert.ok(opt.split(/\s+/).length >= 4, `Expected full proposition option in multiple_choice, got: "${opt}"`);
      }
    }
  }
});



