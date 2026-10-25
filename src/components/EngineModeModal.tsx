import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Key,
  ShieldCheck,
  Check,
  Cpu,
  BookOpen,
  Zap,
  Globe,
  Terminal,
  AlertCircle,
  ExternalLink,
  Lock
} from 'lucide-react';
import { EngineMode, CustomProviderType, CustomAIConfig, VisitorGeminiState } from '../types';

interface EngineModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMode: EngineMode;
  onSelectMode: (mode: EngineMode) => void;
  customConfig?: CustomAIConfig;
  onSaveCustomConfig: (config: CustomAIConfig) => void;
  visitorState?: VisitorGeminiState;
  onOpenVisitorModal?: () => void;
  sharedUrl: string;
}

export const EngineModeModal: React.FC<EngineModeModalProps> = ({
  isOpen,
  onClose,
  currentMode,
  onSelectMode,
  customConfig,
  onSaveCustomConfig,
  visitorState,
  onOpenVisitorModal,
  sharedUrl,
}) => {
  const [activeTab, setActiveTab] = useState<EngineMode>(currentMode);
  const [provider, setProvider] = useState<CustomProviderType>(customConfig?.provider || 'openai');
  const [apiKey, setApiKey] = useState<string>(customConfig?.apiKey || '');
  const [model, setModel] = useState<string>(customConfig?.model || '');
  const [baseUrl, setBaseUrl] = useState<string>(customConfig?.baseUrl || '');

  const [testingStatus, setTestingStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (!isOpen) return null;

  const defaultModels: Record<CustomProviderType, string> = {
    openai: 'gpt-4o',
    grok: 'grok-2-latest',
    llama: 'llama-3.3-70b-versatile',
    gemini: 'gemini-3.8-flash',
  };

  const handleProviderChange = (p: CustomProviderType) => {
    setProvider(p);
    setModel(defaultModels[p]);
    setTestingStatus('idle');
    setTestMessage('');
  };

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setTestingStatus('error');
      setTestMessage('Por favor ingresa una API Key para probar.');
      return;
    }

    setTestingStatus('testing');
    setTestMessage('Verificando credenciales con el proveedor...');

    try {
      const res = await fetch('/api/test-provider-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim(),
          model: model.trim() || defaultModels[provider],
          baseUrl: baseUrl.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setTestingStatus('success');
        setTestMessage(data.message || '¡Clave validada con éxito!');
      } else {
        setTestingStatus('error');
        setTestMessage(data.error || 'Clave inválida o error en el proveedor.');
      }
    } catch (err: any) {
      setTestingStatus('error');
      setTestMessage(err.message || 'Error de conexión.');
    }
  };

  const handleApply = () => {
    if (activeTab === 'custom_keys') {
      const cfg: CustomAIConfig = {
        provider,
        apiKey: apiKey.trim(),
        model: model.trim() || defaultModels[provider],
        baseUrl: baseUrl.trim() || undefined,
      };
      onSaveCustomConfig(cfg);
    }
    onSelectMode(activeTab);
    onClose();
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(sharedUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                Modos de Ejecución & Claves de IA
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Selecciona cómo deseas procesar tus materiales y generar los exámenes.
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

        {/* 4 Modes Selector Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Mode 1: Gemini con mi cuenta de Google (Recomendada) */}
          <button
            type="button"
            onClick={() => setActiveTab('gemini_visitor')}
            className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all ${
              activeTab === 'gemini_visitor'
                ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-950 dark:text-indigo-100'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Recomendada
                </span>
              </div>
              <h4 className="text-xs font-bold leading-tight">Gemini con mi cuenta de Google</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                Usa tu propia clave gratuita de Google AI Studio sin límites compartidos.
              </p>
            </div>
            <div className="mt-3 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
              {activeTab === 'gemini_visitor' && <Check className="w-3.5 h-3.5" />}
              <span>{activeTab === 'gemini_visitor' ? 'Seleccionado' : 'Elegir'}</span>
            </div>
          </button>

          {/* Mode 2: Modo Estudio Sin IA */}
          <button
            type="button"
            onClick={() => setActiveTab('no_ai')}
            className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all ${
              activeTab === 'no_ai'
                ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div>
              <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center mb-2">
                <BookOpen className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold leading-tight">Modo Estudio Sin IA</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                100% local y offline. Sin llamadas a servidores externos ni necesidad de claves.
              </p>
            </div>
            <div className="mt-3 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              {activeTab === 'no_ai' && <Check className="w-3.5 h-3.5" />}
              <span>{activeTab === 'no_ai' ? 'Seleccionado' : 'Elegir'}</span>
            </div>
          </button>

          {/* Mode 3: IA del entorno del creador */}
          <button
            type="button"
            onClick={() => setActiveTab('gemini_env')}
            className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all ${
              activeTab === 'gemini_env'
                ? 'border-purple-500 ring-2 ring-purple-500/20 bg-purple-50/60 dark:bg-purple-950/40 text-purple-950 dark:text-purple-100'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div>
              <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-300 flex items-center justify-center mb-2">
                <Cpu className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold leading-tight">IA del entorno del creador</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                Usa la API Key de Gemini del creador inyectada en el servidor.
              </p>
            </div>
            <div className="mt-3 text-[10px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
              {activeTab === 'gemini_env' && <Check className="w-3.5 h-3.5" />}
              <span>{activeTab === 'gemini_env' ? 'Seleccionado' : 'Elegir'}</span>
            </div>
          </button>

          {/* Mode 4: Claves Propias (BYOK) */}
          <button
            type="button"
            onClick={() => setActiveTab('custom_keys')}
            className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all ${
              activeTab === 'custom_keys'
                ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-50/60 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div>
              <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-300 flex items-center justify-center mb-2">
                <Key className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold leading-tight">Más opciones: Claves BYOK</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                Agrega API keys de Grok, Llama (Groq), OpenAI u otros endpoints.
              </p>
            </div>
            <div className="mt-3 text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
              {activeTab === 'custom_keys' && <Check className="w-3.5 h-3.5" />}
              <span>{activeTab === 'custom_keys' ? 'Configurar' : 'Elegir'}</span>
            </div>
          </button>
        </div>

        {/* Tab Detail Contents */}
        {activeTab === 'gemini_visitor' && (
          <div className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 space-y-3 text-xs text-indigo-950 dark:text-indigo-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm text-indigo-800 dark:text-indigo-300">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Gemini con mi cuenta de Google (Recomendada)</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                {visitorState?.isConnected ? '✓ Clave vinculada' : 'Pendiente de vincular'}
              </span>
            </div>
            <p className="leading-relaxed text-slate-600 dark:text-slate-300">
              Cada visitante usa su propia cuota gratuita de Google AI Studio. Las peticiones van directamente desde tu navegador a la API de Google sin pasar por ningún servidor intermedio.
            </p>
            {onOpenVisitorModal && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenVisitorModal();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 shadow-sm transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{visitorState?.isConnected ? 'Cambiar o verificar mi API Key' : 'Abrir guía de 3 pasos para conectar'}</span>
              </button>
            )}
          </div>
        )}

        {activeTab === 'no_ai' && (
          <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/70 space-y-2.5 text-xs text-amber-950 dark:text-amber-100">
            <div className="flex items-center gap-2 font-bold text-sm text-amber-900 dark:text-amber-200">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Recomendación para Modo Estudio Sin IA (Demo sin IA)</span>
            </div>
            <p className="leading-relaxed">
              Esta versión <strong>Demo Sin IA</strong> es más simple y utiliza un motor heurístico local sin conexión externa. Para que funcione mejor, te recomendamos cargar documentos <strong>Word (.docx), archivos PDF o archivos de texto (.txt, .md)</strong>.
            </p>
            <p className="leading-relaxed">
              Si buscas <strong>mejores resultados, preguntas más avanzadas y un mejor análisis</strong> de tus materiales (incluyendo imágenes y manuscritos), te recomendamos <strong>iniciar sesión con Gemini</strong>. De todas maneras, puedes seguir en este modo si lo deseas pulsando "Guardar y Aplicar Modo".
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('gemini_visitor');
                  if (!visitorState?.isConnected && onOpenVisitorModal) {
                    onClose();
                    onOpenVisitorModal();
                  }
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5 shadow-xs transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Cambiar e iniciar sesión con Gemini</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'gemini_env' && (
          <div className="p-4 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 space-y-2 text-xs text-purple-900 dark:text-purple-200">
            <div className="flex items-center gap-2 font-bold text-sm text-purple-800 dark:text-purple-300">
              <Cpu className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span>IA del entorno del creador</span>
            </div>
            <p className="leading-relaxed">
              Aprovecha la inteligencia de Google AI Studio inyectada en el servidor. Incluye reconocimiento de visión OCR y HTR (caligrafía manuscrita) y el modelo de razonamiento para el <strong>Nivel Jacqueline</strong>.
            </p>
          </div>
        )}

        {activeTab === 'custom_keys' && (
          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Selecciona tu Proveedor de IA:
              </label>
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                <Lock className="w-3 h-3" /> Clave procesada de forma segura
              </span>
            </div>

            {/* Provider Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'grok', label: 'Grok (xAI)', icon: '🚀', desc: 'grok-2-latest' },
                { id: 'llama', label: 'Llama (Groq)', icon: '🦙', desc: 'llama-3.3-70b' },
                { id: 'openai', label: 'OpenAI', icon: '🧠', desc: 'gpt-4o' },
                { id: 'gemini', label: 'Gemini Propio', icon: '💎', desc: 'gemini-3.8-flash' },
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderChange(p.id as CustomProviderType)}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    provider === p.id
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-bold ring-2 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="text-base">{p.icon}</div>
                  <div className="text-xs font-bold mt-1">{p.label}</div>
                  <div className="text-[10px] opacity-75">{p.desc}</div>
                </button>
              ))}
            </div>

            {/* API Key Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                API Key de {provider.toUpperCase()}:
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  provider === 'openai'
                    ? 'sk-...'
                    : provider === 'grok'
                    ? 'xai-...'
                    : provider === 'llama'
                    ? 'gsk_...'
                    : 'AIzaSy...'
                }
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            {/* Model & Base URL (optional) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Modelo específico (opcional):
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={defaultModels[provider]}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Endpoint URL (opcional para proxies/OpenRouter):
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
            </div>

            {/* Test button and status */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTestKey}
                disabled={testingStatus === 'testing' || !apiKey.trim()}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 disabled:opacity-50 transition-colors"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>{testingStatus === 'testing' ? 'Verificando...' : 'Probar Conexión'}</span>
              </button>

              {testMessage && (
                <span
                  className={`text-xs font-medium ${
                    testingStatus === 'success'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {testMessage}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Public Shared URL & Access Information Box */}
        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-indigo-500" />
              <span>URL Pública de Acceso a StudyMaster AI:</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
              En Vivo
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={sharedUrl}
              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-200 select-all"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              {copiedUrl ? '¡Copiado!' : 'Copiar URL'}
            </button>
            <a
              href={sharedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white"
              title="Abrir en pestaña nueva"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleApply}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-2 shadow-md shadow-indigo-600/20 transition-all"
          >
            <Check className="w-4 h-4" />
            <span>Guardar y Aplicar Modo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
