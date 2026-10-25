import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Lock,
  LogOut,
  RefreshCw,
  Check,
  ShieldCheck,
  Zap
} from 'lucide-react';
import {
  getSavedVisitorKey,
  saveVisitorKey,
  clearVisitorKey,
  validateVisitorGeminiKey
} from '../services/geminiClient';
import { VisitorGeminiState } from '../types';

interface VisitorGeminiModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitorState: VisitorGeminiState;
  onUpdateVisitorState: (state: VisitorGeminiState) => void;
}

export const VisitorGeminiModal: React.FC<VisitorGeminiModalProps> = ({
  isOpen,
  onClose,
  visitorState,
  onUpdateVisitorState,
}) => {
  const saved = getSavedVisitorKey();
  const [inputKey, setInputKey] = useState(visitorState.apiKey || saved.apiKey || '');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(visitorState.remember || saved.remember);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    model?: string;
    error?: string;
  } | null>(visitorState.isConnected ? { valid: true, model: visitorState.model } : null);

  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  if (!isOpen) return null;

  const handleValidateKey = async (keyToTest: string) => {
    if (!keyToTest.trim()) {
      setValidationResult({ valid: false, error: 'Por favor pega tu API key de Google AI Studio.' });
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    const res = await validateVisitorGeminiKey(keyToTest.trim());
    setIsValidating(false);
    setValidationResult(res);

    if (res.valid) {
      saveVisitorKey(keyToTest.trim(), remember);
      onUpdateVisitorState({
        apiKey: keyToTest.trim(),
        remember,
        model: res.model || 'gemini-2.5-flash',
        isConnected: true,
      });
    } else {
      onUpdateVisitorState({
        apiKey: '',
        remember,
        model: '',
        isConnected: false,
      });
    }
  };

  const handlePasteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputKey(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (val.trim().length > 25) {
      debounceTimerRef.current = setTimeout(() => {
        handleValidateKey(val.trim());
      }, 500);
    } else {
      setValidationResult(null);
    }
  };

  const handleDisconnect = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    clearVisitorKey();
    setInputKey('');
    setValidationResult(null);
    onUpdateVisitorState({
      apiKey: '',
      remember: false,
      model: '',
      isConnected: false,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs">
      <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 text-white flex items-center justify-center shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                  Gemini con mi cuenta de Google
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300">
                  Recomendado
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Usa tu propia cuota gratuita de Google AI Studio sin límites compartidos.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Guided 3-Step Flow */}
        <div className="space-y-4">
          {/* Paso 1 */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center">1</span>
                Paso 1: Abrir Google AI Studio
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Inicia sesión con tu cuenta de Google habitual en el portal oficial de desarrolladores.
            </p>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all hover:scale-[1.01]"
            >
              <span>Iniciar sesión en Google AI Studio</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Paso 2 */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center">2</span>
              Paso 2: Generar tu clave gratuita
            </span>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Pulsa <strong>«Create API key»</strong> (es gratis) y cópiala al portapapeles.
            </p>
          </div>

          {/* Paso 3 */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center">3</span>
                Paso 3: Pegar tu API Key aquí
              </span>
              <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                <Lock className="w-3 h-3" /> Solo guardada en tu navegador
              </span>
            </div>

            {/* Password input with toggle button */}
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={inputKey}
                onChange={handlePasteChange}
                placeholder="AIzaSy..."
                className="w-full pl-3 pr-20 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="px-2 py-1 rounded text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            {/* Checkbox "Recordar en este navegador" */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => {
                    setRemember(e.target.checked);
                    if (visitorState.isConnected && inputKey) {
                      saveVisitorKey(inputKey, e.target.checked);
                      onUpdateVisitorState({ ...visitorState, remember: e.target.checked });
                    }
                  }}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <span>Recordar en este navegador (localStorage)</span>
              </label>

              {inputKey && !validationResult?.valid && (
                <button
                  type="button"
                  onClick={() => handleValidateKey(inputKey)}
                  disabled={isValidating}
                  className="px-3 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 text-xs font-bold transition-colors"
                >
                  {isValidating ? 'Validando...' : 'Validar Key'}
                </button>
              )}
            </div>

            {/* Validation State Feedback */}
            {isValidating && (
              <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 py-1">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Validando tu key con Google Gemini...</span>
              </div>
            )}

            {validationResult?.valid && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Conectado con tu cuenta de Google ✓</span>
                </div>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                  Modelo asignado: <strong>{validationResult.model || 'gemini-2.5-flash'}</strong> (Flash de alta velocidad y cuota gratuita personal).
                </p>
              </div>
            )}

            {validationResult && !validationResult.valid && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 space-y-1">
                <div className="flex items-center gap-2 font-bold">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  <span>La key no es válida</span>
                </div>
                <p className="text-[11px] text-rose-700 dark:text-rose-300">
                  {validationResult.error || 'Asegúrate de haber copiado toda la cadena generada en Google AI Studio.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Security Guarantee Box */}
        <div className="p-3.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-indigo-900 dark:text-indigo-300">
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            <span>Privacidad y Seguridad Garantizada:</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            Tu clave se almacena exclusivamente en tu dispositivo (en <code>sessionStorage</code> o <code>localStorage</code> si marcas "Recordar"). Las solicitudes a Gemini viajan de forma directa desde tu navegador a los servidores de Google. Nunca se comparte ni se almacena en bases de datos externas.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            {visitorState.isConnected && (
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-3 py-2 rounded-xl text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1.5 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Desconectar</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              Cerrar
            </button>

            {validationResult?.valid && (
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all"
              >
                <Check className="w-4 h-4" />
                <span>Listo, usar mi cuenta</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
