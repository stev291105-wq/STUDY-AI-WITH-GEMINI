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
import { EngineMode, CustomAIConfig } from '../types';

interface HeaderProps {
  darkMode: boolean;
  setDarkMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  docCount: number;
  engineMode: EngineMode;
  customConfig?: CustomAIConfig;
  onOpenEngineModal: () => void;
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
  onOpenEngineModal,
  onOpenVisualAid,
  onResetSession,
  sharedUrl,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleCopyUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(sharedUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  const getModeBadge = () => {
    switch (engineMode) {
      case 'no_ai':
        return {
          label: 'Modo Estudio Sin IA',
          icon: <BookOpen className="w-3.5 h-3.5 text-emerald-500" />,
          style: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
        };
      case 'gemini_env':
        return {
          label: 'Modo con IA (Gemini)',
          icon: <Sparkles className="w-3.5 h-3.5 text-indigo-500" />,
          style: 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800',
        };
      case 'custom_keys':
        return {
          label: `${customConfig?.provider?.toUpperCase() || 'BYOK'} Activo`,
          icon: <Key className="w-3.5 h-3.5 text-amber-500" />,
          style: 'bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800',
        };
    }
  };

  const modeBadge = getModeBadge();

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-white/85 dark:bg-slate-900/85 border-b border-slate-200 dark:border-slate-800 transition-colors">
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

        {/* Center / Actions: Mode Switcher Button */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Engine Mode Pill / Selector Button */}
          <button
            type="button"
            onClick={onOpenEngineModal}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:scale-[1.02] shadow-xs ${modeBadge.style}`}
            title="Cambiar entre: Modo Estudio Sin IA, Modo con IA (Gemini), o Claves Propias (Grok, Llama, OpenAI, Gemini)"
          >
            {modeBadge.icon}
            <span>{modeBadge.label}</span>
            <span className="text-[10px] opacity-60 ml-0.5">▼</span>
          </button>

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
