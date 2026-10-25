import React, { useState } from 'react';
import {
  BookOpen,
  Sparkles,
  Moon,
  Sun,
  Layers,
  Image as ImageIcon,
  Key,
  Globe,
  Share2,
  Check,
  Cpu
} from 'lucide-react';
import { EngineMode, CustomAIConfig, VisitorGeminiState } from '../types';

interface HeaderProps {
  darkMode: boolean;
  setDarkMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  docCount: number;
  engineMode: EngineMode;
  customConfig?: CustomAIConfig;
  visitorState?: VisitorGeminiState;
  onOpenVisitorModal: () => void;
  onOpenEngineModal: () => void;
  onSelectMode: (mode: EngineMode) => void;
  onOpenVisualAid?: () => void;
  onResetSession?: () => void;
  sharedUrl: string;
}

export const Header: React.FC<HeaderProps> = ({
  darkMode,
  setDarkMode,
  docCount,
  engineMode,
  customConfig,
  visitorState,
  onOpenVisitorModal,
  onOpenEngineModal,
  onSelectMode,
  onOpenVisualAid,
  onResetSession,
  sharedUrl,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleCopyUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(sharedUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  const getModeBadge = () => {
    switch (engineMode) {
      case 'gemini_visitor':
        return {
          label: 'Gemini · tu cuenta',
          sublabel: visitorState?.isConnected ? 'Conectado ✓' : 'Configurar key',
          icon: <Sparkles className="w-3.5 h-3.5 text-indigo-500" />,
          style: 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700 font-bold',
        };
      case 'no_ai':
        return {
          label: 'Modo Estudio Sin IA',
          sublabel: 'Sin conexión a IA',
          icon: <BookOpen className="w-3.5 h-3.5 text-emerald-500" />,
          style: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
        };
      case 'gemini_env':
        return {
          label: 'IA del entorno del creador',
          sublabel: 'Cuota del proyecto',
          icon: <Cpu className="w-3.5 h-3.5 text-purple-500" />,
          style: 'bg-purple-50 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-300 dark:border-purple-800',
        };
      case 'custom_keys':
        return {
          label: `${customConfig?.provider?.toUpperCase() || 'BYOK'} Activo`,
          sublabel: 'Clave personalizada',
          icon: <Key className="w-3.5 h-3.5 text-amber-500" />,
          style: 'bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800',
        };
    }
  };

  const modeBadge = getModeBadge();

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-white/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Brand */}
        <button
          onClick={onResetSession}
          className="flex items-center gap-2.5 text-left group focus:outline-none shrink-0"
          title="Ir al inicio de StudyMaster AI"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-amber-500 flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg sm:text-xl tracking-tight text-slate-900 dark:text-white">
                StudyMaster <span className="text-indigo-600 dark:text-indigo-400">AI</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium hidden sm:block">
              Cuestionarios Dinámicos & OCR Multimodal
            </p>
          </div>
        </button>

        {/* Center / Actions: Mode Switcher Button with Dropdown */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mode Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsDropdownOpen(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:scale-[1.02] shadow-xs cursor-pointer ${modeBadge.style}`}
              title="Cambiar modo de ejecución"
            >
              {modeBadge.icon}
              <span>{modeBadge.label}</span>
              <span className="text-[9px] opacity-70 ml-0.5">▼</span>
            </button>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl z-50 p-2 space-y-1">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Modos Principales de Estudio
                  </div>

                  {/* 1. Gemini con mi cuenta de Google (Recomendada) */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsDropdownOpen(false);
                      onSelectMode('gemini_visitor');
                      if (!visitorState?.isConnected) {
                        onOpenVisitorModal();
                      }
                    }}
                    className={`w-full p-2.5 rounded-xl text-left flex items-start justify-between gap-2 transition-colors ${
                      engineMode === 'gemini_visitor'
                        ? 'bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            Gemini con mi cuenta de Google
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Tu cuota personal gratuita de AI Studio sin límites compartidos.
                        </p>
                      </div>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0">
                      Recomendada
                    </span>
                  </button>

                  {/* 2. Modo Estudio Sin IA */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsDropdownOpen(false);
                      onSelectMode('no_ai');
                    }}
                    className={`w-full p-2.5 rounded-xl text-left flex items-start justify-between gap-2 transition-colors ${
                      engineMode === 'no_ai'
                        ? 'bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                        <BookOpen className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Modo Estudio Sin IA
                        </span>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          100% local, sin conexión a IA ni consumo de cuotas.
                        </p>
                      </div>
                    </div>
                    {engineMode === 'no_ai' && (
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-1" />
                    )}
                  </button>

                  {/* 3. IA del entorno del creador */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsDropdownOpen(false);
                      onSelectMode('gemini_env');
                    }}
                    className={`w-full p-2.5 rounded-xl text-left flex items-start justify-between gap-2 transition-colors ${
                      engineMode === 'gemini_env'
                        ? 'bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-7 h-7 rounded-lg bg-purple-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                        <Cpu className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          IA del entorno del creador
                        </span>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Usa la API key precargada en el entorno del servidor.
                        </p>
                      </div>
                    </div>
                    {engineMode === 'gemini_env' && (
                      <Check className="w-4 h-4 text-purple-600 shrink-0 mt-1" />
                    )}
                  </button>

                  {/* Separator & Más Opciones */}
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-1 mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsDropdownOpen(false);
                        onOpenEngineModal();
                      }}
                      className="w-full p-2 rounded-xl text-left flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-amber-500" />
                        <span>Más opciones (Grok, Llama, OpenAI...)</span>
                      </span>
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
                        Ver &rarr;
                      </span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Share App URL button */}
          <button
            type="button"
            onClick={handleCopyUrl}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-colors"
            title="Copiar URL pública de acceso a la web"
          >
            {copiedUrl ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">¡Copiada!</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden md:inline">Publicada</span>
              </>
            )}
          </button>

          {/* Document count pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80">
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
            <span>
              <strong className="text-indigo-600 dark:text-indigo-400">{docCount}</strong> doc{docCount === 1 ? '' : 's'}
            </span>
          </div>

          {/* Visual Aid 1K/4K Button */}
          {onOpenVisualAid && (
            <button
              onClick={onOpenVisualAid}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 dark:bg-amber-400/10 dark:hover:bg-amber-400/20 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-500/30 text-xs font-semibold transition-colors"
              title="Generar mapa conceptual visual en 1K, 2K o 4K"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Infografía 4K</span>
            </button>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={() => setDarkMode(prev => !prev)}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Alternar modo oscuro y claro"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>
        </div>
      </div>
    </header>
  );
};
