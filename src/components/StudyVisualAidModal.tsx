import React, { useState } from 'react';
import { X, Sparkles, Image as ImageIcon, Download, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { UploadedDoc } from '../types';

interface StudyVisualAidModalProps {
  isOpen: boolean;
  onClose: () => void;
  documents: UploadedDoc[];
}

export const StudyVisualAidModal: React.FC<StudyVisualAidModalProps> = ({
  isOpen,
  onClose,
  documents,
}) => {
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('1K');
  const [topic, setTopic] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const defaultTopic = documents.length > 0
    ? documents.map(d => d.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')).join(', ')
    : 'Biología Celular, Derecho y Modelos de IA';

  const currentTopic = topic.trim() || defaultTopic;

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const summaryCombined = documents.map(d => d.analysis?.summary || '').filter(Boolean).join('. ');

      const res = await fetch('/api/generate-study-aid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: currentTopic,
          resolution,
          summary: summaryCombined,
        }),
      });

      const data = await res.json();
      if (data.success && data.imageUrl) {
        setGeneratedImageUrl(data.imageUrl);
      } else {
        setErrorMsg(data.error || 'No se pudo generar la imagen de estudio.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error en la conexión con el servidor.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedImageUrl) return;
    const link = document.createElement('a');
    link.href = generatedImageUrl;
    link.download = `StudyMaster_Infografia_${resolution}.png`;
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                Infografía & Mapa Visual de Estudio
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300">
                  Gemini Imagen
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Genera un esquema visual estructurado con resolución configurable (1K, 2K, 4K).
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

        {/* Resolution Affordance Selector (1K, 2K, 4K) */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
            Selecciona la Resolución de la Imagen:
          </label>
          <div className="grid grid-cols-3 gap-3">
            {(['1K', '2K', '4K'] as const).map(res => (
              <button
                key={res}
                type="button"
                onClick={() => setResolution(res)}
                className={`p-3 rounded-xl border text-center transition-all ${
                  resolution === res
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 ring-2 ring-amber-500/20 font-bold'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="text-sm font-extrabold">{res}</div>
                <div className="text-[10px] opacity-75">
                  {res === '1K' ? '1024×576' : res === '2K' ? '2048×1152' : '3840×2160'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Topic Input */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
            Tema / Enfoque de la Infografía:
          </label>
          <input
            type="text"
            value={topic}
            placeholder={defaultTopic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
          />
        </div>

        {/* Preview of generated image */}
        {generatedImageUrl && (
          <div className="space-y-3">
            <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 shadow-inner max-h-72 flex items-center justify-center">
              <img
                src={generatedImageUrl}
                alt="Infografía generada"
                className="w-full h-auto object-contain max-h-72"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Resolución generada: <strong>{resolution}</strong></span>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar Imagen
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            Cerrar
          </button>

          <button
            type="button"
            disabled={isGenerating}
            onClick={handleGenerate}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-2 shadow-md shadow-amber-500/20 disabled:opacity-50 transition-all"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Renderizando en {resolution}...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{generatedImageUrl ? 'Regenerar Infografía' : `Generar Infografía (${resolution})`}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
