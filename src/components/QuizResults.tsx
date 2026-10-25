import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Trophy,
  Flame,
  Award,
  RotateCcw,
  Sparkles,
  FolderOpen,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  ChevronDown,
  ChevronUp,
  FileText,
  Share2,
  Download
} from 'lucide-react';
import { QuizSummary, QuestionModality } from '../types';

interface QuizResultsProps {
  summary: QuizSummary;
  onRetrySameQuestions: () => void;
  onGenerateNewQuestions: () => void;
  onGoToSetup: () => void;
}

export const QuizResults: React.FC<QuizResultsProps> = ({
  summary,
  onRetrySameQuestions,
  onGenerateNewQuestions,
  onGoToSetup,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'incorrect' | 'correct'>('all');
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Fire confetti on high score or Jacqueline completion
    try {
      if (summary.scorePercentage >= 70 || summary.isJacquelineMaster) {
        confetti({
          particleCount: summary.isJacquelineMaster ? 150 : 80,
          spread: 80,
          origin: { y: 0.6 },
          colors: summary.isJacquelineMaster
            ? ['#ef4444', '#f59e0b', '#fbbf24', '#b91c1c']
            : ['#6366f1', '#3b82f6', '#10b981'],
        });
      }
    } catch {
      // Safe fallback if canvas not available
    }
  }, [summary]);

  const toggleExpand = (id: string) => {
    setExpandedQuestionIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const allExpanded: Record<string, boolean> = {};
    summary.questionsReview.forEach(r => {
      allExpanded[r.question.id] = true;
    });
    setExpandedQuestionIds(allExpanded);
  };

  const collapseAll = () => {
    setExpandedQuestionIds({});
  };

  const filteredQuestions = summary.questionsReview.filter(r => {
    const isCorrect = Boolean(r.userAnswer?.isCorrect);
    if (filterMode === 'correct') return isCorrect;
    if (filterMode === 'incorrect') return !isCorrect;
    return true;
  });

  const getModalityName = (type: QuestionModality) => {
    switch (type) {
      case 'multiple_choice':
        return 'Selección Múltiple';
      case 'true_false':
        return 'Verdadero o Falso';
      case 'fill_blank':
        return 'Completar';
      case 'open_question':
        return 'Pregunta Abierta';
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* 1. Global Score Banner */}
      <div
        className={`relative overflow-hidden rounded-3xl p-6 sm:p-10 border transition-all ${
          summary.isJacquelineMaster
            ? 'bg-gradient-to-br from-red-950 via-slate-900 to-amber-950/80 border-amber-500/80 shadow-2xl shadow-red-500/20 jacqueline-glow'
            : summary.difficulty === 'jacqueline'
            ? 'bg-gradient-to-br from-slate-900 via-red-950/40 to-slate-950 border-red-500/40 shadow-xl'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm'
        }`}
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
          <div className="space-y-3 text-center md:text-left">
            {/* Difficulty Pill */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
              {summary.difficulty === 'jacqueline' ? (
                <span className="flex items-center gap-1.5 bg-gradient-to-r from-red-600 to-amber-600 text-white px-3 py-1 rounded-full shadow-md shadow-red-500/30">
                  <Flame className="w-4 h-4 animate-pulse" /> Nivel Jacqueline (Extremo)
                </span>
              ) : (
                <span className="bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-3 py-1 rounded-full">
                  Dificultad: {summary.difficulty}
                </span>
              )}
            </div>

            <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {summary.isJacquelineMaster ? (
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-amber-300 to-yellow-200">
                  👑 ¡Maestría Jacqueline Conquistada!
                </span>
              ) : summary.scorePercentage >= 80 ? (
                '¡Excelente Desempeño!'
              ) : summary.scorePercentage >= 60 ? (
                'Buen Intento, ¡Sigue Practicando!'
              ) : (
                'Repaso Recomendado'
              )}
            </h2>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-xl">
              Has respondido con éxito <strong>{summary.correctAnswers}</strong> de <strong>{summary.totalQuestions}</strong> preguntas ({summary.scorePercentage}% de efectividad) en un tiempo de <strong>{formatTime(summary.timeSpentSeconds)}</strong>.
            </p>
          </div>

          {/* Big Score Radial/Badge */}
          <div className="flex flex-col items-center justify-center shrink-0">
            <div
              className={`w-32 h-32 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center p-2 shadow-inner border-4 ${
                summary.isJacquelineMaster
                  ? 'border-amber-400 bg-gradient-to-tr from-red-700 to-amber-600 text-white shadow-red-500/50'
                  : summary.scorePercentage >= 80
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                  : 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
              }`}
            >
              <span className="text-3xl sm:text-4xl font-black">{summary.scorePercentage}%</span>
              <span className="text-xs font-bold uppercase tracking-tight mt-0.5">
                {summary.correctAnswers}/{summary.totalQuestions} Aciertos
              </span>
            </div>

            {/* Jacqueline Special Trophy Seal */}
            {summary.isJacquelineMaster && (
              <div className="mt-3 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gradient-to-r from-amber-400 to-yellow-400 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider shadow-md animate-bounce">
                <Trophy className="w-3.5 h-3.5" /> Insignia de Honor Jacqueline
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Modality Breakdown Stats */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
          Desglose de Desempeño por Tipo de Pregunta
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {(Object.keys(summary.modalityBreakdown) as QuestionModality[]).map(key => {
            const stat = summary.modalityBreakdown[key];
            if (stat.total === 0) return null;
            const percent = Math.round((stat.correct / stat.total) * 100);

            return (
              <div
                key={key}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {getModalityName(key)}
                  </span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {stat.correct}/{stat.total}
                  </span>
                </div>

                <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div className="text-[11px] text-right font-medium text-slate-500 dark:text-slate-400">
                  {percent}% de efectividad
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Primary Action Buttons */}
      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
        <button
          type="button"
          onClick={onRetrySameQuestions}
          className="px-5 py-3 rounded-xl text-xs sm:text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-2 shadow-md shadow-indigo-600/20 transition-all hover:scale-[1.02]"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reintentar con las mismas preguntas</span>
        </button>

        <button
          type="button"
          onClick={onGenerateNewQuestions}
          className="px-5 py-3 rounded-xl text-xs sm:text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-2 border border-slate-200 dark:border-slate-700 transition-all"
        >
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <span>Generar nuevas preguntas de estos documentos</span>
        </button>

        <button
          type="button"
          onClick={onGoToSetup}
          className="px-5 py-3 rounded-xl text-xs sm:text-sm font-bold bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-2 border border-slate-200 dark:border-slate-800 transition-all"
        >
          <FolderOpen className="w-4 h-4 text-slate-500" />
          <span>Subir nuevos archivos / Configuración</span>
        </button>
      </div>

      {/* 4. Complete Question Review (Resumen de Estudio) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Revisión Completa (Resumen de Estudio)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Inspecciona cada enunciado, tu respuesta dada y la respuesta ideal extraída de los documentos.
            </p>
          </div>

          {/* Filter Chips & Expand All */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  filterMode === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Todas ({summary.questionsReview.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('incorrect')}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  filterMode === 'incorrect'
                    ? 'bg-rose-500 text-white shadow-xs'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                Falladas ({summary.incorrectAnswers})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('correct')}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  filterMode === 'correct'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                Acertadas ({summary.correctAnswers})
              </button>
            </div>

            <button
              type="button"
              onClick={Object.keys(expandedQuestionIds).length === summary.questionsReview.length ? collapseAll : expandAll}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline px-2 py-1"
            >
              {Object.keys(expandedQuestionIds).length === summary.questionsReview.length ? 'Colapsar todo' : 'Expandir todo'}
            </button>
          </div>
        </div>

        {/* Questions Review List */}
        <div className="space-y-4">
          {filteredQuestions.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">
              No hay preguntas que coincidan con este filtro.
            </div>
          ) : (
            filteredQuestions.map((item, index) => {
              const { question, userAnswer } = item;
              const isCorrect = Boolean(userAnswer?.isCorrect);
              const isExpanded = expandedQuestionIds[question.id] ?? true;

              return (
                <div
                  key={question.id}
                  className={`rounded-2xl border transition-all ${
                    isCorrect
                      ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10'
                      : 'border-rose-200 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/10'
                  }`}
                >
                  {/* Header / Accordion trigger */}
                  <div
                    onClick={() => toggleExpand(question.id)}
                    className="p-4 sm:p-5 flex items-start justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {isCorrect ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-xs text-slate-500 dark:text-slate-400">
                            #{index + 1}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {getModalityName(question.type)}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-md text-[11px] font-extrabold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            Temática: {question.topicTitle || question.sourceSection || 'Conceptos Centrales del Documento'}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                            • {question.sourceDocName}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                          {question.prompt}
                        </h4>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Expanded Body */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-3.5 text-xs sm:text-sm">
                      {/* User's Answer */}
                      <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Tu Respuesta:
                        </span>
                        <p className={`font-semibold ${isCorrect ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                          {userAnswer?.selectedOption || userAnswer?.userText || '(Sin responder)'}
                        </p>
                      </div>

                      {/* Official Ideal Answer */}
                      <div className="p-3.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/70 space-y-1">
                        <span className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300 uppercase tracking-wider">
                          Respuesta Correcta / Ideal del Documento:
                        </span>
                        <p className="font-semibold text-slate-900 dark:text-white whitespace-pre-wrap">
                          {question.officialAnswer || question.correctAnswer}
                        </p>
                      </div>

                      {/* Pedagogical Justification */}
                      {question.explanation && (
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                          <strong className="text-slate-800 dark:text-slate-200">Justificación: </strong>
                          {question.explanation}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
