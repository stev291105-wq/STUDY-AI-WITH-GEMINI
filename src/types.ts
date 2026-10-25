export type QuestionModality = 'multiple_choice' | 'true_false' | 'fill_blank' | 'open_question';

export type DifficultyLevel = 'facil' | 'medio' | 'dificil' | 'jacqueline';

export type EngineMode = 'gemini_visitor' | 'no_ai' | 'gemini_env' | 'custom_keys';

export type CustomProviderType = 'grok' | 'llama' | 'openai' | 'gemini';

export interface VisitorGeminiState {
  apiKey: string;
  remember: boolean;
  model: string;
  isConnected: boolean;
}

export interface CustomAIConfig {
  provider: CustomProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface UploadedDoc {
  id: string;
  name: string;
  size: number;
  type: string;
  extension: string;
  category: 'pdf' | 'word' | 'powerpoint' | 'image' | 'canva' | 'gdoc' | 'other';
  rawText?: string;
  base64Data?: string;
  mimeType?: string;
  status: 'uploading' | 'analyzing' | 'ready' | 'error';
  errorMessage?: string;
  analysis?: {
    summary: string;
    keyThemes: string[];
    hasHandwriting: boolean;
    handwrittenNotes?: string[];
    diagramDescriptions?: string[];
    multimodalNotes?: string;
    wordCount: number;
  };
}

export interface QuizConfig {
  selectedModalities: QuestionModality[]; // Minimum 1, MAXIMUM 3
  difficulty: DifficultyLevel;
  questionCount: number;
  timerPerQuestion?: number; // In seconds, 0 = no timer
  includeDocCrossAnalysis: boolean;
  engineMode: EngineMode;
  customConfig?: CustomAIConfig;
}

export interface Question {
  id: string;
  type: QuestionModality;
  difficulty: DifficultyLevel;
  prompt: string;
  // Multiple Choice or True/False
  options?: string[];
  correctAnswer: string;
  // Fill in the blank
  fillInContext?: {
    sentenceBefore: string;
    targetWord: string;
    sentenceAfter: string;
  };
  // Official reference answer from document
  officialAnswer: string;
  explanation: string;
  sourceDocName: string;
  sourceSection?: string;
  tags?: string[];
}

export interface UserAnswer {
  questionId: string;
  userText?: string;
  selectedOption?: string;
  isCorrect: boolean;
  selfEvaluated?: boolean;
  answeredAt: number;
}

export interface QuizSummary {
  totalQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  scorePercentage: number;
  timeSpentSeconds: number;
  difficulty: DifficultyLevel;
  isJacquelineMaster: boolean;
  modalityBreakdown: Record<QuestionModality, { total: number; correct: number }>;
  questionsReview: Array<{
    question: Question;
    userAnswer?: UserAnswer;
  }>;
}
