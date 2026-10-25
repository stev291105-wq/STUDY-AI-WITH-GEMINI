import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  ArrowRight,
  Clock,
  Flame,
  Award,
  BookOpen,
  Send,
  Sparkles,
  Info,
  Check,
  X,
  FileText,
  PenTool
} from 'lucide-react';
import { Question, UserAnswer, DifficultyLevel, EngineMode, CustomAIConfig, VisitorGeminiState } from '../types';
import { evaluateMechanicA, assessSemanticSimilarity, normalizeText } from '../utils/quizEngine';
import { evaluateVisitorOpenAnswerWithGemini } from '../services/geminiClient';

interface QuizRunnerProps {
  questions: Question[];
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  answers: Record<string, UserAnswer>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, UserAnswer>>>;
  onFinishQuiz: () => void;
  onExitQuiz: () => void;
  difficulty: DifficultyLevel;
  engineMode?: EngineMode;
  customConfig?: CustomAIConfig;
  visitorState?: VisitorGeminiState;
}

export const QuizRunner: React.FC<QuizRunnerProps> = ({
  questions,
  currentIndex,
  setCurrentIndex,
  answers,
  setAnswers,
  onFinishQuiz,
  onExitQuiz,
  difficulty,
  engineMode,
  customConfig,
  visitorState,
}) => {
  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;

  // Local state for current question interaction
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [typedAnswer, setTypedAnswer] = useState<string>('');
  const [hasSubmittedMechanicB, setHasSubmittedMechanicB] = useState<boolean>(false);
  const [timeElapsed, setTimeElapsed] = useState<number>(0);
  const [isAiEvaluating, setIsAiEvaluating] = useState<boolean>(false);
  const [aiFeedback, setAiFeedback] = useState<string>('');
  const [quotaError, setQuotaError] = useState<string>('');

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync state when currentIndex changes
  useEffect(() => {
    const existing = answers[currentQuestion?.id];
    setAiFeedback('');
    setQuotaError('');
    if (existing) {
      setSelectedOption(existing.selectedOption || '');
      setTypedAnswer(existing.userText || '');
      setHasSubmittedMechanicB(Boolean(existing.userText));
    } else {
      setSelectedOption('');
      setTypedAnswer('');
      setHasSubmittedMechanicB(false);
    }
  }, [currentIndex, currentQuestion]);

  if (!currentQuestion) return null;

  const currentAnswer = answers[currentQuestion.id];
  const isEvaluated = currentAnswer !== undefined;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isMechanicA = currentQuestion.type === 'multiple_choice' || currentQuestion.type === 'true_false';
  const isMechanicB = currentQuestion.type === 'fill_blank' || currentQuestion.type === 'open_question';

  // Mechanic A Handler
  const handleSelectOption = (opt: string) => {
    if (isEvaluated) return; // Prevent re-selection once evaluated

    setSelectedOption(opt);
    const { isCorrect } = evaluateMechanicA(currentQuestion, opt);

    const newAnswer: UserAnswer = {
      questionId: currentQuestion.id,
      selectedOption: opt,
      isCorrect,
      answeredAt: Date.now(),
    };

    setAnswers(prev => ({ ...prev, [currentQuestion.id]: newAnswer }));
  };

  // Helper to validate with visitor Gemini
  const handleAiValidate = async (text: string) => {
    if (engineMode !== 'gemini_visitor' || !visitorState?.apiKey) return;
    setIsAiEvaluating(true);
    setQuotaError('');
    try {
      const result = await evaluateVisitorOpenAnswerWithGemini(
        currentQuestion.prompt,
        currentQuestion.officialAnswer || currentQuestion.correctAnswer,
        text,
        visitorState.apiKey,
        visitorState.model
      );
      setAiFeedback(result.feedback);
      // Auto-update answer correctness if not already manually self-evaluated
      setAnswers(prev => {
        const curr = prev[currentQuestion.id];
        if (curr && !curr.selfEvaluated) {
          return {
            ...prev,
            [currentQuestion.id]: {
              ...curr,
              isCorrect: result.isCorrect,
            },
          };
        }
        return prev;
      });
    } catch (err: any) {
      if (err.message?.includes('Alcanzaste el límite gratuito')) {
        setQuotaError(err.message);
      } else {
        setQuotaError(`Error al evaluar con Gemini: ${err.message?.slice(0, 90) || 'Error desconocido'}`);
      }
    } finally {
      setIsAiEvaluating(false);
    }
  };

  // Mechanic B Submit Handler
  const handleSubmitMechanicB = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!typedAnswer.trim()) return;

    setHasSubmittedMechanicB(true);

    // Initial tentative assessment based on text similarity
    const comparison = assessSemanticSimilarity(typedAnswer, currentQuestion.officialAnswer || currentQuestion.correctAnswer);

    // Record answer in pending state until self-evaluated
    const tentativeAnswer: UserAnswer = {
      questionId: currentQuestion.id,
      userText: typedAnswer,
      isCorrect: comparison.suggestedMatch,
      selfEvaluated: false,
      answeredAt: Date.now(),
    };

    setAnswers(prev => ({ ...prev, [currentQuestion.id]: tentativeAnswer }));

    // If Gemini visitor key is active, evaluate open question with AI!
    if (engineMode === 'gemini_visitor' && visitorState?.apiKey) {
      handleAiValidate(typedAnswer);
    }
  };

  // Mechanic B Self Evaluation Handler ("Respondí bien" / "Me equivoqué")
  const handleSelfEvaluation = (isHit: boolean) => {
    const updatedAnswer: UserAnswer = {
      questionId: currentQuestion.id,
      userText: typedAnswer,
      isCorrect: isHit,
      selfEvaluated: true,
      answeredAt: Date.now(),
    };

    setAnswers(prev => ({ ...prev, [currentQuestion.id]: updatedAnswer }));
  };

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      onFinishQuiz();
    }
  };

  const progressPercent = Math.round(((currentIndex + 1) / totalQuestions) * 100);

  const getModalityLabel = (type: Question['type']) => {
    switch (type) {
      case 'multiple_choice':
        return 'Selección Múltiple';
      case 'true_false':
        return 'Verdadero o Falso';
      case 'fill_blank':
        return 'Completar Espacio';
      case 'open_question':
        return 'Pregunta Abierta';
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top HUD Cluster */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
          {/* Progress and Question Counter */}
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-slate-900 dark:text-white text-base">
              Pregunta {currentIndex + 1} <span className="text-slate-400 font-normal">/ {totalQuestions}</span>
            </span>

            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {getModalityLabel(currentQuestion.type)}
            </span>

            {difficulty === 'jacqueline' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-gradient-to-r from-red-600 to-amber-600 text-white shadow-sm shadow-red-500/30">
                <Flame className="w-3.5 h-3.5 animate-pulse" /> Jacqueline
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 capitalize">
                {difficulty}
              </span>
            )}
          </div>

          {/* Time and Exit */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-mono text-xs sm:text-sm">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>{formatTime(timeElapsed)}</span>
            </div>

            <button
              onClick={onExitQuiz}
              className="text-xs font-medium text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
            >
              Salir del test
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              difficulty === 'jacqueline'
                ? 'bg-gradient-to-r from-red-500 to-amber-500'
                : 'bg-indigo-600 dark:bg-indigo-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Main Question Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        {/* Source citation badge */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-indigo-500" />
            <span>Documento: <strong className="text-slate-700 dark:text-slate-300">{currentQuestion.sourceDocName}</strong></span>
            {currentQuestion.sourceSection && (
              <span className="hidden sm:inline text-slate-400">• {currentQuestion.sourceSection}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {engineMode === 'no_ai' ? (
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                <BookOpen className="w-3 h-3" /> Modo Estudio Sin IA
              </span>
            ) : engineMode === 'custom_keys' ? (
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                <Sparkles className="w-3 h-3" /> {customConfig?.provider?.toUpperCase() || 'BYOK'}
              </span>
            ) : difficulty === 'jacqueline' ? (
              <span className="text-[11px] font-bold text-amber-500 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" /> Gemini Thinking Correlated
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-500" /> Gemini Multimodal
              </span>
            )}
          </div>
        </div>

        {/* Thematic Title + Question Prompt */}
        <div className="space-y-3">
          <div
            data-testid="question-topic-title"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-indigo-50/90 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800/80 text-indigo-800 dark:text-indigo-200 text-xs sm:text-sm font-extrabold tracking-tight"
          >
            <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>
              Temática:{' '}
              <span className="text-indigo-950 dark:text-white">
                {currentQuestion.topicTitle || currentQuestion.sourceSection || 'Conceptos Centrales del Documento'}
              </span>
            </span>
          </div>

          <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-relaxed">
            {currentQuestion.prompt}
          </h3>

          {/* If Fill in the Blank: Show formatted sentence with gap if available */}
          {currentQuestion.type === 'fill_blank' && currentQuestion.fillInContext && (
            <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-sm sm:text-base leading-loose text-slate-800 dark:text-slate-200">
              <span>{currentQuestion.fillInContext.sentenceBefore} </span>
              <span className="inline-block px-3 py-0.5 mx-1 font-mono font-bold text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-500 dark:border-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/70 rounded">
                {hasSubmittedMechanicB ? typedAnswer || '_______' : '___________'}
              </span>
              <span> {currentQuestion.fillInContext.sentenceAfter}</span>
            </div>
          )}
        </div>

        {/* MECÁNICA A: Selección Múltiple y Verdadero / Falso */}
        {isMechanicA && currentQuestion.options && (
          <div className="space-y-3 pt-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {isEvaluated ? 'Resultado de la evaluación:' : 'Selecciona una respuesta:'}
            </p>

            <div className="grid grid-cols-1 gap-3">
              {currentQuestion.options.map((option, idx) => {
                const isSelected = selectedOption === option;
                const isCorrectOption = normalizeText(option) === normalizeText(currentQuestion.correctAnswer);

                // Styling logic for instant validation
                let buttonStyle = 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-indigo-300 dark:hover:border-indigo-700 text-slate-800 dark:text-slate-200';

                if (isEvaluated) {
                  if (isCorrectOption) {
                    // Always show the correct option in green
                    buttonStyle = 'border-emerald-500 bg-emerald-50/90 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-100 ring-2 ring-emerald-500/30 font-semibold';
                  } else if (isSelected && !isCorrectOption) {
                    // Selected wrong option in red
                    buttonStyle = 'border-rose-500 bg-rose-50/90 dark:bg-rose-950/80 text-rose-900 dark:text-rose-100 ring-2 ring-rose-500/30';
                  } else {
                    buttonStyle = 'opacity-40 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-400';
                  }
                }

                return (
                  <button
                    key={idx}
                    type="button"
                    data-testid="option-button"
                    disabled={isEvaluated}
                    onClick={() => handleSelectOption(option)}
                    className={`w-full p-4 rounded-xl border text-left flex items-center justify-between gap-3 transition-all ${buttonStyle} ${
                      !isEvaluated ? 'cursor-pointer hover:scale-[1.005]' : 'cursor-default'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center justify-center shrink-0">
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span className="text-sm font-medium leading-normal">{option}</span>
                    </div>

                    {isEvaluated && (
                      <div className="shrink-0">
                        {isCorrectOption ? (
                          <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <span className="hidden sm:inline">Correcta</span>
                          </div>
                        ) : isSelected ? (
                          <div className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-bold text-xs">
                            <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                            <span className="hidden sm:inline">Tu respuesta</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* MECÁNICA B: Completar y Preguntas Abiertas */}
        {isMechanicB && (
          <div className="space-y-4 pt-2">
            {!hasSubmittedMechanicB ? (
              <form onSubmit={handleSubmitMechanicB} className="space-y-3">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  {currentQuestion.type === 'fill_blank'
                    ? 'Escribe la palabra o concepto que falta:'
                    : 'Redacta tu respuesta en base a los documentos:'}
                </label>

                {currentQuestion.type === 'fill_blank' ? (
                  <input
                    type="text"
                    value={typedAnswer}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    placeholder="Escribe el concepto faltante..."
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    autoFocus
                  />
                ) : (
                  <textarea
                    rows={4}
                    value={typedAnswer}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    placeholder="Explica detalladamente la respuesta según lo visto en el documento..."
                    className="w-full p-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed"
                    autoFocus
                  />
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-slate-400">
                    Presiona "Enviar respuesta" para constatar contra la versión oficial del documento.
                  </span>

                  <button
                    type="submit"
                    disabled={!typedAnswer.trim()}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    <span>Enviar respuesta</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            ) : (
              /* After submission: Show student's submitted text */
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Tu respuesta enviada:</span>
                <p className="text-sm font-medium text-slate-900 dark:text-white whitespace-pre-wrap">
                  {typedAnswer}
                </p>
              </div>
            )}

            {/* Inmediately after submission: Reveal Official Document Answer Card + Self-evaluation buttons */}
            {hasSubmittedMechanicB && (
              <div className="mt-4 p-5 rounded-2xl bg-gradient-to-br from-indigo-50/80 via-white to-indigo-50/30 dark:from-slate-900 dark:via-indigo-950/20 dark:to-slate-900 border-2 border-indigo-400/60 dark:border-indigo-500/50 shadow-md space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-indigo-100 dark:border-indigo-900/60 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-extrabold text-indigo-950 dark:text-indigo-200">
                        Respuesta Oficial del Documento
                      </h4>
                      <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
                        Coteja tu respuesta con el texto y autoevalúa tu acierto
                      </p>
                    </div>
                  </div>

                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300">
                    Oficial
                  </span>
                </div>

                <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium whitespace-pre-wrap bg-white dark:bg-slate-900 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                  {currentQuestion.officialAnswer || currentQuestion.correctAnswer}
                </div>

                {/* Quota error banner if 429 occurs */}
                {quotaError && (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                    <span className="text-base shrink-0">⚠️</span>
                    <div>
                      <div className="font-bold">Aviso de cuota Gemini</div>
                      <p>{quotaError}</p>
                    </div>
                  </div>
                )}

                {/* AI evaluating loader */}
                {isAiEvaluating && (
                  <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 font-semibold p-2">
                    <Sparkles className="w-3.5 h-3.5 animate-spin" />
                    <span>Gemini (con tu cuenta de Google) está evaluando la precisión de tu respuesta...</span>
                  </div>
                )}

                {/* AI feedback display */}
                {aiFeedback && (
                  <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-indigo-900 dark:text-indigo-300">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Evaluación pedagógica de Gemini (tu cuenta):</span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{aiFeedback}</p>
                  </div>
                )}

                {/* Self-evaluation prompt and buttons */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-slate-900/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      ¿Tu respuesta fue correcta respecto al documento?
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Selecciona una opción para computar tu puntaje global:
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelfEvaluation(true)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                        currentAnswer?.isCorrect === true && currentAnswer?.selfEvaluated
                          ? 'bg-emerald-600 text-white ring-2 ring-emerald-500/40 shadow-sm'
                          : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      <span>Respondí bien (+1)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelfEvaluation(false)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                        currentAnswer?.isCorrect === false && currentAnswer?.selfEvaluated
                          ? 'bg-rose-600 text-white ring-2 ring-rose-500/40 shadow-sm'
                          : 'bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                      }`}
                    >
                      <X className="w-4 h-4" />
                      <span>Me equivoqué (0)</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Immediate Explanation Feedback Card (for Mechanic A or once submitted in Mechanic B) */}
        {isEvaluated && currentQuestion.explanation && (
          <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
              <Info className="w-4 h-4 text-indigo-500" />
              <span>Justificación pedagógica del documento:</span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              {currentQuestion.explanation}
            </p>
          </div>
        )}

        {/* Navigation Action */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {isEvaluated ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Pregunta evaluada
              </span>
            ) : (
              <span>Responde para habilitar el avance</span>
            )}
          </span>

          <button
            type="button"
            disabled={!isEvaluated}
            onClick={handleNext}
            className={`px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all ${
              isEvaluated
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 hover:scale-[1.02]'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
            }`}
          >
            <span>{currentIndex < totalQuestions - 1 ? 'Siguiente Pregunta' : 'Finalizar y Ver Resultados'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
