import React, { useState } from 'react';
import {
  Sliders,
  CheckSquare,
  HelpCircle,
  FileCheck,
  Edit3,
  Flame,
  Award,
  Sparkles,
  Zap,
  ShieldAlert,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Cpu,
  BookOpen,
  Key
} from 'lucide-react';
import { DifficultyLevel, QuestionModality, QuizConfig, UploadedDoc, VisitorGeminiState } from '../types';
import { toggleModalitySelection } from '../utils/quizEngine';

interface QuizConfigPanelProps {
  config: QuizConfig;
  setConfig: React.Dispatch<React.SetStateAction<QuizConfig>>;
  documents: UploadedDoc[];
  onStartQuiz: () => void;
  isGenerating: boolean;
  onLoadPresets?: () => void;
  visitorState?: VisitorGeminiState;
  onOpenVisitorModal?: () => void;
  onOpenEngineModal?: () => void;
}

export const QuizConfigPanel: React.FC<QuizConfigPanelProps> = ({
  config,
  setConfig,
  documents,
  onStartQuiz,
  isGenerating,
  visitorState,
  onOpenVisitorModal,
  onOpenEngineModal,
}) => {
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const { selectedModalities, difficulty, questionCount, engineMode, customConfig } = config;

  // Modalities metadata
  const modalityOptions: Array<{
    id: QuestionModality;
    title: string;
    description: string;
    icon: React.ReactNode;
    tag: string;
  }> = [
    {
      id: 'multiple_choice',
      title: 'Selección Múltiple',
      description: '4 opciones plausibles generadas con distractores inteligentes. Solo 1 correcta.',
      icon: <CheckSquare className="w-5 h-5 text-indigo-500" />,
      tag: 'Mecánica A: Corrección instantánea'
    },
    {
      id: 'true_false',
      title: 'Verdadero o Falso',
      description: 'Afirmaciones directas o inferidas para validar tu agudeza conceptual.',
      icon: <FileCheck className="w-5 h-5 text-blue-500" />,
      tag: 'Mecánica A: Corrección instantánea'
    },
    {
      id: 'fill_blank',
      title: 'Completar (Fill in the blank)',
      description: 'Oraciones clave con espacios en blanco para escribir el concepto o término exacto.',
      icon: <Edit3 className="w-5 h-5 text-amber-500" />,
      tag: 'Mecánica B: Respuesta oficial + Autoevaluación'
    },
    {
      id: 'open_question',
      title: 'Preguntas Abiertas',
      description: 'Preguntas de desarrollo que exigen sintetizar y explicar conceptos del texto.',
      icon: <HelpCircle className="w-5 h-5 text-purple-500" />,
      tag: 'Mecánica B: Respuesta oficial + Autoevaluación'
    }
  ];

  // Difficulty options
  const difficultyOptions: Array<{
    id: DifficultyLevel;
    label: string;
    subtitle: string;
    description: string;
    badgeStyle: string;
    isJacqueline?: boolean;
  }> = [
    {
      id: 'facil',
      label: 'Fácil',
      subtitle: 'Definiciones Literales',
      description: 'Preguntas directas sobre conceptos básicos y terminología explícita.',
      badgeStyle: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800'
    },
    {
      id: 'medio',
      label: 'Medio',
      subtitle: 'Comprensión y Relación',
      description: 'Comprensión de ideas secundarias, relaciones entre conceptos y aplicación estándar.',
      badgeStyle: 'text-blue-700 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800'
    },
    {
      id: 'dificil',
      label: 'Difícil',
      subtitle: 'Análisis Profundo',
      description: 'Preguntas de inferencia compleja, análisis crítico y casos prácticos rigurosos.',
      badgeStyle: 'text-orange-700 bg-orange-50 dark:bg-orange-950/60 border-orange-200 dark:border-orange-800'
    },
    {
      id: 'jacqueline',
      label: 'Jacqueline',
      subtitle: 'NIVEL MAESTRO / EXTREMO',
      description: 'Preguntas ultra-específicas, capciosas, correlación avanzada cruzada entre documentos y detalles microscópicos con IA de Pensamiento Profundo.',
      badgeStyle: 'text-amber-500 bg-gradient-to-r from-red-600 to-amber-600 text-white shadow-lg shadow-red-500/25',
      isJacqueline: true
    }
  ];

  const handleToggleModality = (id: QuestionModality) => {
    const { updated } = toggleModalitySelection(selectedModalities, id);
    setConfig(prev => ({ ...prev, selectedModalities: updated }));
  };

  const isModalityDisabled = (id: QuestionModality) => {
    // If not selected and already 3 selected, block it!
    return !selectedModalities.includes(id) && selectedModalities.length >= 3;
  };

  const quickCountOptions = [5, 10, 15, 20, 30];

  return (
    <div className="space-y-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm">
      <div className="border-b border-slate-100 dark:border-slate-800 pb-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sliders className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              2. Panel de Configuración del Test
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Personaliza la experiencia según tus metas de estudio. Elige las modalidades de pregunta, el nivel de exigencia y la cantidad de ítems.
            </p>
          </div>

          {onOpenEngineModal && (
            <button
              type="button"
              onClick={onOpenEngineModal}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 shrink-0 self-start sm:self-auto transition-colors"
            >
              <span>⚙️ Configurar Claves / IA</span>
            </button>
          )}
        </div>

        {/* Mode Selector Banner: 3 Main Options + Más Opciones */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <span>FORMA DE USO DEL GENERADOR:</span>
            <span className="text-[11px] font-medium text-slate-500">
              {engineMode === 'gemini_visitor'
                ? '⭐ Gemini · Tu cuenta de Google'
                : engineMode === 'no_ai'
                ? '🟢 Modo Estudio Sin IA (Local)'
                : engineMode === 'gemini_env'
                ? '⚡ IA del entorno del creador'
                : `🔑 Proveedor ${customConfig?.provider?.toUpperCase() || 'Externo'}`}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {/* Option 1: Gemini con mi cuenta de Google (Recomendada) */}
            <div
              onClick={() => {
                setConfig(prev => ({ ...prev, engineMode: 'gemini_visitor' }));
                if (!visitorState?.isConnected && onOpenVisitorModal) {
                  onOpenVisitorModal();
                }
              }}
              className={`relative p-3.5 rounded-xl text-left transition-all border cursor-pointer ${
                engineMode === 'gemini_visitor'
                  ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/70 text-indigo-950 dark:text-indigo-100 ring-2 ring-indigo-500/20 shadow-xs'
                  : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900'
              }`}
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="flex items-center gap-1.5 font-bold text-xs text-indigo-600 dark:text-indigo-400">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  <span>Gemini con mi cuenta de Google</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0">
                  Recomendada
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                Tu cuota gratuita personal de AI Studio sin compartir límites con otros.
              </p>
              <div className="mt-2.5 pt-2 border-t border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between text-[10px]">
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                  {visitorState?.isConnected ? '✓ Clave guardada' : 'Pulsa para conectar'}
                </span>
                {onOpenVisitorModal && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfig(prev => ({ ...prev, engineMode: 'gemini_visitor' }));
                      onOpenVisitorModal();
                    }}
                    className="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-300 underline font-medium"
                  >
                    {visitorState?.isConnected ? 'Gestionar key' : 'Conectar gratis'}
                  </button>
                )}
              </div>
            </div>

            {/* Option 2: Modo Estudio Sin IA */}
            <button
              type="button"
              onClick={() => setConfig(prev => ({ ...prev, engineMode: 'no_ai' }))}
              className={`p-3.5 rounded-xl text-left transition-all border cursor-pointer ${
                engineMode === 'no_ai'
                  ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/70 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500/20 shadow-xs'
                  : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-700 dark:text-emerald-400">
                <BookOpen className="w-4 h-4 text-emerald-600" />
                <span>Modo Estudio Sin IA</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                100% local, autónomo y privado. No requiere conexión a IA ni API keys.
              </p>
              <div className="mt-2.5 pt-2 border-t border-emerald-100 dark:border-emerald-900/50 flex items-center justify-between text-[10px]">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {engineMode === 'no_ai' ? '✓ Activo' : 'Seleccionar'}
                </span>
                <span className="text-slate-400 font-normal">Sin cuota</span>
              </div>
            </button>

            {/* Option 3: IA del entorno del creador */}
            <button
              type="button"
              onClick={() => setConfig(prev => ({ ...prev, engineMode: 'gemini_env' }))}
              className={`p-3.5 rounded-xl text-left transition-all border cursor-pointer ${
                engineMode === 'gemini_env'
                  ? 'border-purple-500 bg-purple-50/80 dark:bg-purple-950/70 text-purple-950 dark:text-purple-100 ring-2 ring-purple-500/20 shadow-xs'
                  : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold text-xs text-purple-700 dark:text-purple-400">
                <Cpu className="w-4 h-4 text-purple-600" />
                <span>IA del entorno del creador</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                Utiliza la cuota y clave de Gemini precargada en el entorno del proyecto.
              </p>
              <div className="mt-2.5 pt-2 border-t border-purple-100 dark:border-purple-900/50 flex items-center justify-between text-[10px]">
                <span className="font-semibold text-purple-700 dark:text-purple-400">
                  {engineMode === 'gemini_env' ? '✓ Activo' : 'Seleccionar'}
                </span>
                <span className="text-slate-400 font-normal">Servidor</span>
              </div>
            </button>
          </div>

          {/* Más Opciones Button & Collapsible */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowMoreOptions(prev => !prev)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              <span>{showMoreOptions ? 'Ocultar opciones adicionales' : 'Más opciones de conexión'}</span>
              {showMoreOptions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showMoreOptions && (
              <div className="mt-2.5 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                      Claves de otros proveedores (BYOK)
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Configura claves API de Grok (xAI), Llama (Groq), OpenAI (ChatGPT) u otro endpoint.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setConfig(prev => ({ ...prev, engineMode: 'custom_keys' }));
                      if (onOpenEngineModal) onOpenEngineModal();
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      engineMode === 'custom_keys'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {customConfig?.apiKey ? `Configurar (${customConfig.provider.toUpperCase()})` : 'Ingresar clave BYOK'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 1. Modalidades de Pregunta */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <label className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span>1. Modalidades de Preguntas</span>
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              (Elige 1 o combina hasta un máximo de 3)
            </span>
          </label>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-bold border transition-colors ${
                selectedModalities.length === 3
                  ? 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800'
              }`}
            >
              {selectedModalities.length} / 3 modos seleccionados
              {selectedModalities.length >= 3 ? ' (Máximo)' : ''}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
          {modalityOptions.map(mod => {
            const isChecked = selectedModalities.includes(mod.id);
            const disabled = isModalityDisabled(mod.id);

            return (
              <div
                key={mod.id}
                onClick={() => {
                  if (!disabled || isChecked) {
                    handleToggleModality(mod.id);
                  }
                }}
                className={`relative p-4 rounded-xl border text-left transition-all ${
                  disabled && !isChecked
                    ? 'opacity-45 cursor-not-allowed bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'
                    : isChecked
                    ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-950/40 cursor-pointer shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      {mod.icon}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        {mod.title}
                      </h4>
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        {mod.tag}
                      </span>
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={disabled && !isChecked}
                    onChange={() => handleToggleModality(mod.id)}
                    aria-label={`Seleccionar modalidad ${mod.title}`}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 mt-1 cursor-pointer"
                  />
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 mt-2.5 line-clamp-2">
                  {mod.description}
                </p>

                {disabled && !isChecked && (
                  <div className="mt-2 text-[11px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" /> Bloqueado: ya tienes 3 modalidades
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Selector de Nivel de Dificultad */}
      <div className="space-y-3">
        <label className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <span>2. Selector de Nivel de Dificultad</span>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {difficultyOptions.map(diff => {
            const isSelected = difficulty === diff.id;
            const isJacqueline = diff.isJacqueline;

            if (isJacqueline) {
              return (
                <button
                  key={diff.id}
                  type="button"
                  onClick={() => setConfig(prev => ({ ...prev, difficulty: diff.id }))}
                  className={`relative p-4 rounded-xl border-2 text-left transition-all cursor-pointer overflow-hidden ${
                    isSelected
                      ? 'border-red-500 ring-2 ring-red-500/30 bg-gradient-to-br from-red-950/70 via-slate-900 to-amber-950/60 shadow-lg shadow-red-500/20 jacqueline-glow'
                      : 'border-amber-500/50 hover:border-red-500 bg-gradient-to-br from-slate-900 to-slate-950 text-slate-200'
                  }`}
                >
                  <div className="absolute top-0 right-0 transform translate-x-3 -translate-y-2">
                    <span className="inline-block px-4 py-0.5 text-[9px] font-black uppercase tracking-wider text-white bg-gradient-to-r from-red-600 to-amber-500 rotate-12 shadow-md">
                      EXTREMO
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-red-600 to-amber-500 flex items-center justify-center text-white shadow-md">
                      <Flame className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-amber-300 to-yellow-200">
                        {diff.label}
                      </h4>
                      <p className="text-[10px] font-bold text-amber-400 uppercase tracking-tight">
                        {diff.subtitle}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 mt-2 leading-relaxed font-normal">
                    {diff.description}
                  </p>

                  <div className="mt-3 pt-2 border-t border-red-500/30 flex items-center justify-between text-[11px] font-semibold text-amber-300">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-400" /> Thinking High
                    </span>
                    <span className="text-xs font-bold">
                      {isSelected ? '✓ Seleccionado' : 'Elegir'}
                    </span>
                  </div>
                </button>
              );
            }

            return (
              <button
                key={diff.id}
                type="button"
                onClick={() => setConfig(prev => ({ ...prev, difficulty: diff.id }))}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-950/40 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    {diff.label}
                  </h4>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${diff.badgeStyle}`}>
                    {diff.subtitle}
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {diff.description}
                </p>

                <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <span>Dificultad</span>
                  <span className={`font-semibold ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                    {isSelected ? '✓ Seleccionado' : 'Elegir'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Cantidad de Preguntas */}
      <div className="space-y-3">
        <label className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
          <span>3. Cantidad de Preguntas</span>
          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            {questionCount} preguntas en este test
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {quickCountOptions.map(cnt => (
            <button
              key={cnt}
              type="button"
              onClick={() => setConfig(prev => ({ ...prev, questionCount: cnt }))}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                questionCount === cnt
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 scale-105'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
              }`}
            >
              {cnt} preguntas
            </button>
          ))}

          {/* Custom Input */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-slate-500 dark:text-slate-400">Personalizado:</span>
            <input
              type="number"
              min={3}
              max={50}
              value={questionCount}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 3;
                setConfig(prev => ({ ...prev, questionCount: Math.min(50, Math.max(3, val)) }));
              }}
              className="w-20 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-white text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Call to Action Bar */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {documents.length === 0 ? (
            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-semibold">
              <Zap className="w-4 h-4 shrink-0" /> Sube al menos 1 documento o imagen en la sección superior para habilitar el inicio del cuestionario.
            </span>
          ) : (
            <span>
              Generando test exclusivamente a partir de <strong>{documents.length} documento{documents.length === 1 ? '' : 's'}</strong> subido{documents.length === 1 ? '' : 's'}.
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={onStartQuiz}
            disabled={isGenerating || selectedModalities.length === 0 || documents.length === 0}
            className={`w-full sm:w-auto px-7 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md ${
              difficulty === 'jacqueline'
                ? 'bg-gradient-to-r from-red-600 via-amber-600 to-red-600 text-white shadow-red-500/30 hover:scale-[1.02] active:scale-[0.98]'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/25 hover:scale-[1.02] active:scale-[0.98]'
            } disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none`}
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Analizando y Generando Test...</span>
              </>
            ) : (
              <>
                <span>Iniciar Cuestionario ({questionCount} preguntas)</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
