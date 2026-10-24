import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleModalitySelection,
  normalizeText,
  evaluateMechanicA,
  assessSemanticSimilarity,
  calculateQuizSummary,
  generateFallbackQuestions,
  PRESET_SAMPLE_DOCUMENTS,
} from './quizEngine';
import { DifficultyLevel, QuestionModality, Question, UserAnswer, QuizConfig } from '../types';

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
  // List remains unchanged at 3
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

  // 4 out of 5 correct = 80% on Jacqueline -> should unlock Jacqueline Master badge!
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
  assert.equal(summaryPass.modalityBreakdown.multiple_choice.total, 2);
  assert.equal(summaryPass.modalityBreakdown.multiple_choice.correct, 1);
  assert.equal(summaryPass.modalityBreakdown.true_false.correct, 1);

  // If score is 60% on Jacqueline -> does not unlock Jacqueline Master badge
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
