import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  FileText,
  FileCode,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Sparkles,
  Eye,
  PenTool,
  Cpu,
  Layers,
  FolderOpen
} from 'lucide-react';
import { UploadedDoc } from '../types';
import { PRESET_SAMPLE_DOCUMENTS } from '../utils/quizEngine';

interface DocIngestionProps {
  documents: UploadedDoc[];
  setDocuments: React.Dispatch<React.SetStateAction<UploadedDoc[]>>;
  onAnalyzeDoc: (doc: UploadedDoc) => Promise<void>;
  isAnalyzing: boolean;
}

export const DocIngestion: React.FC<DocIngestionProps> = ({
  documents,
  setDocuments,
  onAnalyzeDoc,
  isAnalyzing,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<UploadedDoc | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getDocCategory = (filename: string, mime: string): UploadedDoc['category'] => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['doc', 'docx', 'gdoc'].includes(ext)) return 'word';
    if (['ppt', 'pptx'].includes(ext)) return 'powerpoint';
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'heic'].includes(ext)) return 'image';
    if (filename.toLowerCase().includes('canva')) return 'canva';
    return 'other';
  };

  const processFiles = async (files: FileList | File[]) => {
    const newDocs: UploadedDoc[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
      const category = getDocCategory(file.name, file.type);
      const isImage = category === 'image' || file.type.startsWith('image/');

      const docId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      // Read text or base64
      let rawText = '';
      let base64Data: string | undefined = undefined;

      try {
        if (isImage) {
          base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          rawText = `[Imagen multimodal detectada: ${file.name} - En espera de análisis visual OCR/HTR]`;
        } else {
          // For text, markdown, docx/pdf text extraction preview
          rawText = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string) || '');
            reader.onerror = () => resolve(`Contenido del archivo ${file.name}`);
            reader.readAsText(file.slice(0, 50000));
          });
          // Also store base64 if PDF or small document for multimodal Gemini inspection
          if (file.size < 15 * 1024 * 1024) {
            base64Data = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            });
          }
        }
      } catch (err) {
        console.warn('Error reading file:', err);
        rawText = `Documento ${file.name} preparado para procesamiento.`;
      }

      const doc: UploadedDoc = {
        id: docId,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        extension,
        category,
        rawText,
        base64Data,
        mimeType: file.type || 'application/octet-stream',
        status: 'uploading',
      };

      newDocs.push(doc);
    }

    setDocuments(prev => [...prev, ...newDocs]);

    // Trigger analysis for each newly added doc
    for (const doc of newDocs) {
      await onAnalyzeDoc(doc);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
      // Reset input value so same files can be re-selected if desired
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadSamples = () => {
    // Add presets without duplicating ids
    setDocuments(prev => {
      const existingNames = new Set(prev.map(d => d.name));
      const freshSamples = PRESET_SAMPLE_DOCUMENTS.filter(s => !existingNames.has(s.name));
      return [...prev, ...freshSamples];
    });
  };

  const handleRemoveDoc = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (selectedPreviewDoc?.id === id) {
      setSelectedPreviewDoc(null);
    }
  };

  const handleClearAll = () => {
    setDocuments([]);
    setSelectedPreviewDoc(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getCategoryBadge = (cat: UploadedDoc['category']) => {
    switch (cat) {
      case 'pdf':
        return { label: 'PDF', color: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800' };
      case 'word':
        return { label: 'Word / Docs', color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800' };
      case 'powerpoint':
        return { label: 'PowerPoint', color: 'bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300 border-orange-200 dark:border-orange-800' };
      case 'canva':
        return { label: 'Canva Design', color: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800' };
      case 'image':
        return { label: 'Imagen / HTR', color: 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800' };
      default:
        return { label: 'Documento', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Callout */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            1. Ingesta de Documentos & OCR Multimodal
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Sube archivos ilimitados en cualquier formato. La IA analiza texto digital nativo, esquemas de Canva y <strong>reconoce apuntes escritos a mano (HTR)</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleLoadSamples}
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-sm transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            Cargar 4 ejemplos reales
          </button>

          {documents.length > 0 && (
            <button
              onClick={handleClearAll}
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              title="Borrar todos los documentos"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Drag & Drop Zone (Supports unlimited uploads) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-10 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 scale-[0.99]'
            : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md"
          onChange={handleFileInputChange}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-inner">
            <UploadCloud className="w-7 h-7" />
          </div>

          <div>
            <p className="text-base font-bold text-slate-800 dark:text-slate-200">
              Arrastra y suelta tus archivos aquí, o <span className="text-indigo-600 dark:text-indigo-400 underline">haz clic para explorar</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
              Carga ilimitada sin restricciones • PDF, Word (.docx), PowerPoint (.pptx), Diseños Canva, Fotos de cuadernos/apuntes manuscritos (.jpg, .png)
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              PDF & Docs
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              PPTX & Canva
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-100/80 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 flex items-center gap-1 font-semibold">
              <PenTool className="w-3 h-3" /> HTR Manuscrito
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-100/80 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center gap-1 font-semibold">
              <Cpu className="w-3 h-3" /> OCR Gráficos
            </span>
          </div>
        </div>
      </div>

      {/* Document Grid */}
      {documents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
            <span>DOCUMENTOS CARGADOS EN ESTA SESIÓN ({documents.length})</span>
            <span>Haz clic en un documento para ver su análisis OCR</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {documents.map(doc => {
              const badge = getCategoryBadge(doc.category);
              const isSelected = selectedPreviewDoc?.id === doc.id;

              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedPreviewDoc(isSelected ? null : doc)}
                  className={`group relative p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-950/30'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-700 shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {doc.category === 'image' ? (
                          <ImageIcon className="w-5 h-5" />
                        ) : doc.category === 'powerpoint' ? (
                          <Layers className="w-5 h-5" />
                        ) : (
                          <FileText className="w-5 h-5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {doc.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge.color}`}>
                            {badge.label}
                          </span>
                          <span>{formatFileSize(doc.size)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleRemoveDoc(doc.id, e)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title="Eliminar documento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* OCR & HTR Detection Indicators */}
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-1.5 text-xs">
                    {doc.analysis?.hasHandwriting ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold border border-emerald-200 dark:border-emerald-800">
                        <PenTool className="w-3 h-3 text-emerald-500" /> HTR: Manuscrito detectado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[11px]">
                        <CheckCircle2 className="w-3 h-3 text-slate-400" /> Texto digital extraído
                      </span>
                    )}

                    {doc.analysis?.diagramDescriptions && doc.analysis.diagramDescriptions.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium border border-indigo-200 dark:border-indigo-800">
                        <Cpu className="w-3 h-3 text-indigo-500" /> Esquema interpretado
                      </span>
                    )}

                    <span className="ml-auto text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1">
                      <Eye className="w-3 h-3" /> {isSelected ? 'Ocultar detalles' : 'Ver análisis'}
                    </span>
                  </div>

                  {/* Expanded detail when selected */}
                  {isSelected && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-2 bg-slate-50 dark:bg-slate-950/60 p-3 rounded-lg">
                      {doc.analysis?.summary && (
                        <div>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Resumen pedagógico:</span>
                          <p className="text-slate-600 dark:text-slate-400 mt-0.5">{doc.analysis.summary}</p>
                        </div>
                      )}

                      {doc.analysis?.handwrittenNotes && doc.analysis.handwrittenNotes.length > 0 && (
                        <div>
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                            <PenTool className="w-3 h-3" /> Transcripción HTR (Texto manuscrito):
                          </span>
                          <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-0.5 space-y-0.5">
                            {doc.analysis.handwrittenNotes.map((note, i) => (
                              <li key={i}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {doc.analysis?.keyThemes && doc.analysis.keyThemes.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {doc.analysis.keyThemes.map((theme, i) => (
                            <span key={i} className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-medium">
                              #{theme}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
