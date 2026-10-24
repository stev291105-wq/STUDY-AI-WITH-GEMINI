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
import {
  UploadedDoc,
  QuizConfig,
  Question,
  UserAnswer,
  QuizSummary,
  EngineMode,
  CustomAIConfig
} from './types';
import { PRESET_SAMPLE_DOCUMENTS, generateFallbackQuestions, calculateQuizSummary } from './utils/quizEngine';

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

  // Quiz Configuration
  const [config, setConfig] = useState<QuizConfig>({
    selectedModalities: ['multiple_choice', 'true_false'],
    difficulty: 'medio',
    questionCount: 5,
    includeDocCrossAnalysis: true,
    engineMode: 'no_ai', // Default to Modo Estudio Sin IA as requested for rapid local access!
    customConfig: customAIConfig,
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

  // Analyze single document with backend API
  const handleAnalyzeDoc = async (doc: UploadedDoc) => {
    setIsAnalyzing(true);
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
      // Fallback ready
      setDocuments(prev =>
        prev.map(d => (d.id === doc.id ? { ...d, status: 'ready' } : d))
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Start Quiz generator
  const handleStartQuiz = async () => {
    if (documents.length === 0) {
      setDocuments(PRESET_SAMPLE_DOCUMENTS);
    }

    setIsGenerating(true);

    try {
      const activeDocs = documents.length > 0 ? documents : PRESET_SAMPLE_DOCUMENTS;

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
        // Fallback generator
        const fallback = generateFallbackQuestions(activeDocs, config);
        setQuestions(fallback);
      }

      // Reset runner state
      setCurrentIndex(0);
      setAnswers({});
      setQuizStartTime(Date.now());
      setAppState('playing');
    } catch (err) {
      console.warn('Questions generation fallback:', err);
      const fallback = generateFallbackQuestions(
        documents.length > 0 ? documents : PRESET_SAMPLE_DOCUMENTS,
        config
      );
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
        onOpenEngineModal={() => setIsEngineModalOpen(true)}
        onOpenVisualAid={() => setIsVisualAidOpen(true)}
        onResetSession={handleGoToSetup}
        sharedUrl={SHARED_APP_URL}
      />

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
        sharedUrl={SHARED_APP_URL}
      />
    </div>
  );
}
