import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Trash2,
  Eye,
  PenTool,
  Cpu,
  Layers,
  FolderOpen,
  Edit3
} from 'lucide-react';
import { UploadedDoc } from '../types';
import { extractTextFromFile, buildLocalDocAnalysis } from '../utils/documentParser';

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
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<UploadedDoc | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [extractingStatus, setExtractingStatus] = useState<string>('');
  const [pastedTitle, setPastedTitle] = useState<string>('');
  const [pastedText, setPastedText] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getDocCategory = (filename: string): UploadedDoc['category'] => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['txt', 'md'].includes(ext)) return 'text';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['doc', 'docx', 'gdoc', 'odt', 'rtf'].includes(ext)) return 'word';
    if (['ppt', 'pptx'].includes(ext)) return 'powerpoint';
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'heic'].includes(ext)) return 'image';
    if (filename.toLowerCase().includes('canva')) return 'canva';
    return 'other';
  };

  const handleAddPastedText = async () => {
    const trimmed = pastedText.trim();
    if (!trimmed) return;

    const pastedIndex = documents.filter(d => d.category === 'text').length + 1;
    let finalTitle = pastedTitle.trim();
    if (!finalTitle) {
      const firstLine = trimmed
        .split(/\r?\n/)
        .map(l => l.replace(/^[#*\-•>\s]+/, '').trim())
        .find(l => l.length > 0);
      if (firstLine && firstLine.length >= 3 && firstLine.length <= 72 && !/[.?!]$/.test(firstLine)) {
        finalTitle = firstLine;
      } else {
        finalTitle = `Texto pegado ${pastedIndex}`;
      }
    }

    const docId = `doc-txt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const byteSize = new Blob([trimmed]).size;

    const initialAnalysis = buildLocalDocAnalysis({
      name: finalTitle,
      category: 'text',
      rawText: trimmed,
    });

    const newDoc: UploadedDoc = {
      id: docId,
      name: finalTitle,
      size: byteSize,
      type: 'text/plain',
      extension: '.txt',
      category: 'text',
      rawText: trimmed,
      mimeType: 'text/plain',
      status: 'ready',
      selected: true,
      analysis: initialAnalysis,
    };

    setPastedTitle('');
    setPastedText('');

    setDocuments(prev => {
      const userOnlyDocs = prev.filter(d => !d.id.startsWith('sample-doc-'));
      return [...userOnlyDocs, newDoc];
    });

    setSelectedPreviewDoc(newDoc);
    await onAnalyzeDoc(newDoc);
  };

  const processFiles = async (files: FileList | File[]) => {
    const newDocs: UploadedDoc[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
      const category = getDocCategory(file.name);

      setExtractingStatus(
        category === 'image'
          ? `Detectando texto con OCR óptico en "${file.name}"...`
          : category === 'pdf'
          ? `Extrayendo y depurando texto PDF de "${file.name}"...`
          : `Procesando "${file.name}"...`
      );

      const docId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      let rawText = '';
      let base64Data: string | undefined = undefined;

      try {
        const extracted = await extractTextFromFile(file);
        rawText = extracted.rawText;
        base64Data = extracted.base64Data;
      } catch (err) {
        console.warn('Error reading file:', err);
        rawText = '';
      }

      const initialAnalysis = buildLocalDocAnalysis({
        name: file.name,
        category,
        rawText,
      });

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
        status: 'ready',
        selected: true,
        analysis: initialAnalysis,
      };

      newDocs.push(doc);
    }

    setExtractingStatus('');

    // CRITICAL: When the user uploads their own document(s), automatically remove any preset sample documents
    // so the study session uses ONLY the user's uploaded documents!
    setDocuments(prev => {
      const userOnlyDocs = prev.filter(d => !d.id.startsWith('sample-doc-'));
      return [...userOnlyDocs, ...newDocs];
    });

    if (newDocs.length > 0) {
      setSelectedPreviewDoc(newDocs[0]);
    }

    // Trigger analysis for each newly added doc
    for (const doc of newDocs) {
      await onAnalyzeDoc(doc);
    }
  };

  const handleToggleSelectDoc = (docId: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setDocuments(prev =>
      prev.map(d => (d.id === docId ? { ...d, selected: d.selected === false ? true : false } : d))
    );
  };

  const handleUpdateDocText = (docId: string, newText: string) => {
    setDocuments(prev =>
      prev.map(d => {
        if (d.id !== docId) return d;
        const updatedAnalysis = buildLocalDocAnalysis({
          name: d.name,
          category: d.category,
          rawText: newText,
        });
        const updatedDoc = {
          ...d,
          rawText: newText,
          analysis: updatedAnalysis,
        };
        if (selectedPreviewDoc?.id === docId) {
          setSelectedPreviewDoc(updatedDoc);
        }
        return updatedDoc;
      })
    );
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
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
      case 'text':
        return { label: 'TXT', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' };
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

  const selectedDocsCount = documents.filter(d => d.selected !== false).length;

  return (
    <div className="space-y-6">
      {/* Header and Callout */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            1. Sube tu material (Ingesta de Documentos & OCR Multimodal)
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Sube tus documentos, imágenes o pega directamente tus apuntes. Las preguntas en <strong>todos los modos (con o sin IA)</strong> se generarán <strong>exclusivamente</strong> del material activo aquí.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {documents.length > 0 && (
            <button
              onClick={handleClearAll}
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              title="Borrar todos los documentos"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpiar lista
            </button>
          )}
        </div>
      </div>

      {/* Drag & Drop Zone */}
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
          aria-label="Subir archivos de estudio"
          className="hidden"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.json,.html"
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
              Soporta documentos PDF digitales o escaneados, Word (.docx), PowerPoint (.pptx), apuntes de texto (.txt, .md) e imágenes con reconocimiento óptico de texto (OCR).
            </p>
            {extractingStatus && (
              <div className="mt-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-sm animate-pulse">
                <Cpu className="w-3.5 h-3.5 animate-spin" />
                <span>{extractingStatus}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              PDF & Docs (.docx, .txt)
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              PPTX & Canva
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-100/80 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 flex items-center gap-1 font-semibold">
              <PenTool className="w-3 h-3" /> HTR Manuscrito
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-100/80 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center gap-1 font-semibold">
              <Cpu className="w-3 h-3" /> OCR Imágenes y Escaneos
            </span>
          </div>
        </div>
      </div>

      {/* Nueva Opción: Añadir texto (Justo debajo del cuadro de subir archivos) */}
      <div
        data-testid="add-text-section"
        className="rounded-2xl border-2 border-emerald-300/90 dark:border-emerald-800/90 bg-gradient-to-br from-emerald-50/60 via-white to-slate-50 dark:from-emerald-950/25 dark:via-slate-900 dark:to-slate-900 p-5 sm:p-6 shadow-xs space-y-4"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                Añadir texto
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Pega directamente tus apuntes, resúmenes o libros completos sin límite de extensión. Conserva títulos y secciones automáticamente.
              </p>
            </div>
          </div>

          {/* Cartel llamativo requerido */}
          <div
            data-testid="add-text-recommended-badge"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-500 to-emerald-600 text-white text-[11px] sm:text-xs font-black tracking-wide shadow-sm uppercase leading-snug"
          >
            <span>⭐</span>
            <span>
              RECOMENDADO (SI USAS EL MODO DEMO SIN IA YA QUE EL TEXTO PEGADO AQUÍ SERÁ MÁS SIMPLE Y REQUIERE MENOS PROCESAMIENTO)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label
              htmlFor="pasted-doc-title"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Título del material <span className="font-normal text-slate-500">(opcional — si se deja vacío se nombra con la primera línea o «Texto pegado 1, 2…»)</span>
            </label>
            <input
              id="pasted-doc-title"
              data-testid="pasted-text-title-input"
              type="text"
              value={pastedTitle}
              onChange={(e) => setPastedTitle(e.target.value)}
              placeholder="Ej. Resumen para el oral Psicodiagnóstico y Entrevista..."
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col justify-end">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1 px-1">
              <span>Capacidad ilimitada</span>
              <span data-testid="pasted-text-char-counter" className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {pastedText.length.toLocaleString('es-ES')} caracteres
              </span>
            </div>
            <button
              type="button"
              data-testid="add-pasted-text-btn"
              onClick={handleAddPastedText}
              disabled={!pastedText.trim()}
              className="w-full py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Añadir</span>
            </button>
          </div>
        </div>

        <div>
          <textarea
            data-testid="pasted-text-textarea"
            rows={5}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Pega aquí cualquier cantidad de apuntes, resúmenes o libros completos (decenas o cientos de páginas). Se conservarán los títulos y apartados para detectar el tema principal y la referencia específica de cada pregunta..."
            className="w-full p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed focus:ring-2 focus:ring-emerald-500 focus:outline-none resize-y"
          />
        </div>
      </div>

      {/* Document Grid */}
      {documents.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
            <span>
              MATERIALES EN LA SESIÓN ({selectedDocsCount} seleccionados de {documents.length})
            </span>
            <span>Marca o desmarca cada material para incluirlo en el test, o haz clic para ver su texto</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {documents.map(doc => {
              const badge = getCategoryBadge(doc.category);
              const isSelected = selectedPreviewDoc?.id === doc.id;
              const isDocChecked = doc.selected !== false;
              const isEditing = editingDocId === doc.id;

              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedPreviewDoc(isSelected ? null : doc)}
                  className={`group relative p-4 rounded-xl border transition-all cursor-pointer ${
                    !isDocChecked
                      ? 'opacity-60 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40'
                      : isSelected
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-950/30'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-700 shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        onClick={(e) => handleToggleSelectDoc(doc.id, e)}
                        className="pt-1 flex items-center"
                        title={isDocChecked ? 'Incluido en el cuestionario (clic para deseleccionar)' : 'Excluido del cuestionario (clic para seleccionar)'}
                      >
                        <input
                          type="checkbox"
                          data-testid={`select-doc-${doc.id}`}
                          checked={isDocChecked}
                          onChange={(e) => handleToggleSelectDoc(doc.id, e)}
                          aria-label={`Seleccionar documento ${doc.name}`}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </div>

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
                          <span
                            data-testid={`doc-badge-${doc.category}`}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge.color}`}
                          >
                            {badge.label}
                          </span>
                          <span>{formatFileSize(doc.size)}</span>
                          {doc.analysis?.wordCount ? (
                            <span>• {doc.analysis.wordCount} palabras</span>
                          ) : null}
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
                    ) : isDocChecked ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[11px]">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Seleccionado para el test
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-500 text-[11px]">
                        Deseleccionado (no se incluirá)
                      </span>
                    )}

                    {doc.analysis?.diagramDescriptions && doc.analysis.diagramDescriptions.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium border border-indigo-200 dark:border-indigo-800">
                        <Cpu className="w-3 h-3 text-indigo-500" /> Esquema interpretado
                      </span>
                    )}

                    <span className="ml-auto text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1">
                      <Eye className="w-3 h-3" /> {isSelected ? 'Ocultar detalles' : 'Ver análisis / texto'}
                    </span>
                  </div>

                  {/* Expanded detail when selected */}
                  {isSelected && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-2.5 bg-slate-50 dark:bg-slate-950/60 p-3 rounded-lg cursor-default"
                    >
                      {doc.analysis?.summary && (
                        <div>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Resumen extraído del documento:</span>
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

                      {/* Editable raw text section so user can inspect or paste/refine document text */}
                      <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            Texto fuente del documento:
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingDocId(isEditing ? null : doc.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>{isEditing ? 'Listo' : 'Editar / Pegar texto'}</span>
                          </button>
                        </div>

                        {isEditing ? (
                          <textarea
                            rows={5}
                            value={doc.rawText || ''}
                            onChange={(e) => handleUpdateDocText(doc.id, e.target.value)}
                            placeholder="Pega o edita aquí el texto o apuntes de este documento para generar preguntas aún más específicas..."
                            className="w-full p-2.5 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                        ) : (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-3 font-mono bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">
                            {doc.rawText
                              ? doc.rawText.slice(0, 300) + (doc.rawText.length > 300 ? '...' : '')
                              : 'Sin texto plano directo (puedes pulsar "Editar / Pegar texto" o usar el análisis multimodal con IA).'}
                          </p>
                        )}
                      </div>
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
