/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { DocIngestion } from './components/DocIngestion';
import { QuizConfigPanel } from './components/QuizConfigPanel';
import { QuizRunner } from './components/QuizRunner';
import { QuizResults } from './components/QuizResults';
import { StudyVisualAidModal } from './components/StudyVisualAidModal';
import { EngineModeModal } from './components/EngineModeModal';
import { VisitorGeminiModal } from './components/VisitorGeminiModal';
import {
  UploadedDoc,
  QuizConfig,
  Question,
  UserAnswer,
  QuizSummary,
  EngineMode,
  CustomAIConfig,
  VisitorGeminiState
} from './types';
import { PRESET_SAMPLE_DOCUMENTS, generateFallbackQuestions, calculateQuizSummary } from './utils/quizEngine';
import {
  getSavedVisitorKey,
  analyzeVisitorDocWithGemini,
  generateVisitorQuestionsWithGemini
} from './services/geminiClient';
import { AlertCircle, BookOpen, X } from 'lucide-react';

const SHARED_APP_URL = 'https://ais-pre-oxfgvh62n37n2ogxmc7uos-221001034983.us-west1.run.app';

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Synchronize dark mode class on root
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Main application state
  const [appState, setAppState] = useState<'setup' | 'playing' | 'results'>('setup');

  // Documents: Seed with rich presets so the user can test all modalities immediately!
  const [documents, setDocuments] = useState<UploadedDoc[]>(PRESET_SAMPLE_DOCUMENTS);

  // Visitor Gemini Account State (Client-Side Only, never sent to server)
  const [visitorState, setVisitorState] = useState<VisitorGeminiState>(() => {
    const saved = getSavedVisitorKey();
    return {
      apiKey: saved.apiKey,
      remember: saved.remember,
      model: saved.apiKey ? 'gemini-2.5-flash' : '',
      isConnected: Boolean(saved.apiKey),
    };
  });

  // Custom AI credentials stored in localStorage
  const [customAIConfig, setCustomAIConfig] = useState<CustomAIConfig | undefined>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('studymaster_custom_ai');
        if (stored) return JSON.parse(stored);
      } catch {}
    }
    return undefined;
  });

  // Quiz Configuration: Recommended default is "gemini_visitor" (Gemini con mi cuenta de Google)
  const [config, setConfig] = useState<QuizConfig>(() => {
    const saved = getSavedVisitorKey();
    return {
      selectedModalities: ['multiple_choice', 'true_false'],
      difficulty: 'medio',
      questionCount: 5,
      includeDocCrossAnalysis: true,
      engineMode: saved.apiKey ? 'gemini_visitor' : 'gemini_visitor',
      customConfig: undefined,
    };
  });

  // Keep config in sync with customAIConfig
  useEffect(() => {
    setConfig(prev => ({ ...prev, customConfig: customAIConfig }));
  }, [customAIConfig]);

  // Save custom AI config
  const handleSaveCustomConfig = (newCfg: CustomAIConfig) => {
    setCustomAIConfig(newCfg);
    try {
      localStorage.setItem('studymaster_custom_ai', JSON.stringify(newCfg));
    } catch {}
  };

  // Active quiz session state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<Record<string, UserAnswer>>({});
  const [quizStartTime, setQuizStartTime] = useState<number>(0);
  const [quizSummary, setQuizSummary] = useState<QuizSummary | null>(null);

  // Loading and Modal states
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isVisualAidOpen, setIsVisualAidOpen] = useState<boolean>(false);
  const [isEngineModalOpen, setIsEngineModalOpen] = useState<boolean>(false);
  const [isVisitorModalOpen, setIsVisitorModalOpen] = useState<boolean>(false);
  const [appQuotaMessage, setAppQuotaMessage] = useState<string>('');

  // Check ?autostart=1 on mount to allow instant testability
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        const fallback = generateFallbackQuestions(PRESET_SAMPLE_DOCUMENTS, {
          selectedModalities: ['multiple_choice', 'true_false'],
          difficulty: 'medio',
          questionCount: 5,
          includeDocCrossAnalysis: true,
          engineMode: 'no_ai',
        });
        setQuestions(fallback);
        setCurrentIndex(0);
        setAnswers({});
        setQuizStartTime(Date.now());
        setAppState('playing');
      }
    }
  }, []);

  // Analyze single document (supports visitor client-side Gemini, server env, or no_ai)
  const handleAnalyzeDoc = async (doc: UploadedDoc) => {
    setIsAnalyzing(true);
    setAppQuotaMessage('');

    // If Visitor Gemini mode is active and key is present, execute directly in browser!
    if (config.engineMode === 'gemini_visitor') {
      if (!visitorState.isConnected || !visitorState.apiKey) {
        setIsVisitorModalOpen(true);
        setIsAnalyzing(false);
        return;
      }

      try {
        const analysisResult = await analyzeVisitorDocWithGemini(doc, visitorState.apiKey);
        setDocuments(prev =>
          prev.map(d =>
            d.id === doc.id
              ? {
                  ...d,
                  status: 'ready',
                  analysis: analysisResult,
                }
              : d
          )
        );
      } catch (err: any) {
        if (err.message?.includes('Alcanzaste el límite gratuito')) {
          setAppQuotaMessage('Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.');
        }
        setDocuments(prev =>
          prev.map(d => (d.id === doc.id ? { ...d, status: 'ready' } : d))
        );
      } finally {
        setIsAnalyzing(false);
      }
      return;
    }

    // Server-side or external API analysis
    try {
      const res = await fetch('/api/analyze-multimodal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc,
          engineMode: config.engineMode,
          customConfig: config.customConfig,
        }),
      });
      const data = await res.json();
      if (data.success && data.analysis) {
        setDocuments(prev =>
          prev.map(d =>
            d.id === doc.id
              ? {
                  ...d,
                  status: 'ready',
                  analysis: data.analysis,
                  rawText: data.extractedText || d.rawText,
                }
              : d
          )
        );
      }
    } catch (err) {
      console.warn('Doc analysis warning:', err);
      setDocuments(prev =>
        prev.map(d => (d.id === doc.id ? { ...d, status: 'ready' } : d))
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Start Quiz generator
  const handleStartQuiz = async () => {
    const activeDocs = documents.length > 0 ? documents : PRESET_SAMPLE_DOCUMENTS;
    if (documents.length === 0) {
      setDocuments(PRESET_SAMPLE_DOCUMENTS);
    }

    setAppQuotaMessage('');

    // Case 1: Visitor Gemini Mode
    if (config.engineMode === 'gemini_visitor') {
      if (!visitorState.isConnected || !visitorState.apiKey) {
        // Guide user to connect their free Google Gemini key
        setIsVisitorModalOpen(true);
        return;
      }

      setIsGenerating(true);
      try {
        const generated = await generateVisitorQuestionsWithGemini(activeDocs, config, visitorState.apiKey);
        setQuestions(generated);
        setCurrentIndex(0);
        setAnswers({});
        setQuizStartTime(Date.now());
        setAppState('playing');
      } catch (err: any) {
        if (err.message?.includes('Alcanzaste el límite gratuito') || err.message?.includes('429')) {
          setAppQuotaMessage('Alcanzaste el límite gratuito de tu cuenta de Gemini; espera un minuto o usa el Modo Estudio Sin IA.');
        }
        // Fallback generator so the user is never stuck
        const fallback = generateFallbackQuestions(activeDocs, config);
        setQuestions(fallback);
        setCurrentIndex(0);
        setAnswers({});
        setQuizStartTime(Date.now());
        setAppState('playing');
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    // Case 2: Server-side Gemini or Custom Keys or No AI
    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docs: activeDocs,
          config,
        }),
      });

      const data = await res.json();

      if (data.success && Array.isArray(data.questions) && data.questions.length > 0) {
        setQuestions(data.questions);
      } else {
        const fallback = generateFallbackQuestions(activeDocs, config);
        setQuestions(fallback);
      }

      setCurrentIndex(0);
      setAnswers({});
      setQuizStartTime(Date.now());
      setAppState('playing');
    } catch (err) {
      console.warn('Questions generation fallback:', err);
      const fallback = generateFallbackQuestions(activeDocs, config);
      setQuestions(fallback);
      setCurrentIndex(0);
      setAnswers({});
      setQuizStartTime(Date.now());
      setAppState('playing');
    } finally {
      setIsGenerating(false);
    }
  };

  // Finish Quiz and calculate summary
  const handleFinishQuiz = () => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - quizStartTime) / 1000));
    const summary = calculateQuizSummary(questions, answers, config.difficulty, elapsedSeconds);
    setQuizSummary(summary);
    setAppState('results');
  };

  // Retry with same questions
  const handleRetrySameQuestions = () => {
    setCurrentIndex(0);
    setAnswers({});
    setQuizStartTime(Date.now());
    setAppState('playing');
  };

  // Generate fresh questions
  const handleGenerateNewQuestions = () => {
    handleStartQuiz();
  };

  // Return to setup
  const handleGoToSetup = () => {
    setAppState('setup');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <Header
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        docCount={documents.length}
        engineMode={config.engineMode}
        customConfig={config.customConfig}
        visitorState={visitorState}
        onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
        onOpenEngineModal={() => setIsEngineModalOpen(true)}
        onSelectMode={(mode: EngineMode) => setConfig(prev => ({ ...prev, engineMode: mode }))}
        onOpenVisualAid={() => setIsVisualAidOpen(true)}
        onResetSession={handleGoToSetup}
        sharedUrl={SHARED_APP_URL}
      />

      {/* Global Quota Alert Banner if 429 triggered */}
      {appQuotaMessage && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs sm:text-sm font-bold">
                  {appQuotaMessage}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  Puedes continuar practicando de forma ilimitada y sin esperas activando el Modo Estudio Sin IA.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => {
                  setConfig(prev => ({ ...prev, engineMode: 'no_ai' }));
                  setAppQuotaMessage('');
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Usar Modo Estudio Sin IA</span>
              </button>
              <button
                type="button"
                onClick={() => setAppQuotaMessage('')}
                className="p-1.5 text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-white"
                title="Cerrar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {appState === 'setup' && (
          <div className="space-y-10">
            {/* Hero Banner */}
            <div className="text-center space-y-3 max-w-3xl mx-auto pt-2 pb-2">
              <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-slate-900 dark:text-white">
                Cuestionarios Dinámicos con{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-indigo-500 to-amber-500">
                  OCR Multimodal
                </span>
              </h1>
              <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
                Analiza Word, PDF, PowerPoint, infografías de Canva y fotos de tus apuntes manuscritos (HTR). Ponte a prueba con 4 modalidades interactivas y supera el exclusivo <strong>Nivel Jacqueline</strong>.
              </p>

              {/* Shared Access URL Pill */}
              <div className="pt-2 flex items-center justify-center">
                <a
                  href={SHARED_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>URL Pública de Acceso: <span className="underline font-mono">{SHARED_APP_URL}</span></span>
                </a>
              </div>
            </div>

            {/* 1. Ingestion */}
            <DocIngestion
              documents={documents}
              setDocuments={setDocuments}
              onAnalyzeDoc={handleAnalyzeDoc}
              isAnalyzing={isAnalyzing}
            />

            {/* 2. Configuration */}
            <QuizConfigPanel
              config={config}
              setConfig={setConfig}
              documents={documents}
              onStartQuiz={handleStartQuiz}
              isGenerating={isGenerating}
              onLoadPresets={() => setDocuments(PRESET_SAMPLE_DOCUMENTS)}
              visitorState={visitorState}
              onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
              onOpenEngineModal={() => setIsEngineModalOpen(true)}
            />
          </div>
        )}

        {appState === 'playing' && (
          <QuizRunner
            questions={questions}
            currentIndex={currentIndex}
            setCurrentIndex={setCurrentIndex}
            answers={answers}
            setAnswers={setAnswers}
            onFinishQuiz={handleFinishQuiz}
            onExitQuiz={handleGoToSetup}
            difficulty={config.difficulty}
            engineMode={config.engineMode}
            customConfig={config.customConfig}
            visitorState={visitorState}
          />
        )}

        {appState === 'results' && quizSummary && (
          <QuizResults
            summary={quizSummary}
            onRetrySameQuestions={handleRetrySameQuestions}
            onGenerateNewQuestions={handleGenerateNewQuestions}
            onGoToSetup={handleGoToSetup}
          />
        )}
      </main>

      {/* Visual Aid Modal (1K, 2K, 4K affordance) */}
      <StudyVisualAidModal
        isOpen={isVisualAidOpen}
        onClose={() => setIsVisualAidOpen(false)}
        documents={documents}
      />

      {/* Engine & Custom Keys Modal */}
      <EngineModeModal
        isOpen={isEngineModalOpen}
        onClose={() => setIsEngineModalOpen(false)}
        currentMode={config.engineMode}
        onSelectMode={(mode: EngineMode) => setConfig(prev => ({ ...prev, engineMode: mode }))}
        customConfig={customAIConfig}
        onSaveCustomConfig={handleSaveCustomConfig}
        visitorState={visitorState}
        onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
        sharedUrl={SHARED_APP_URL}
      />

      {/* Guided 3-Step Modal for Gemini con mi cuenta de Google */}
      {isVisitorModalOpen && (
        <VisitorGeminiModal
          isOpen={isVisitorModalOpen}
          onClose={() => setIsVisitorModalOpen(false)}
          visitorState={visitorState}
          onUpdateVisitorState={(newState) => {
            setVisitorState(newState);
            if (newState.isConnected) {
              setConfig(prev => ({ ...prev, engineMode: 'gemini_visitor' }));
            }
          }}
        />
      )}
    </div>
  );
}
