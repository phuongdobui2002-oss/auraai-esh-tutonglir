
export enum TutorMode {
  CONVERSATION = 'CONVERSATION',
  IELTS = 'IELTS',
  TUTOR_30_DAYS = 'TUTOR_30_DAYS'
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export interface VocabularyItem {
  word: string;
  meaning: string;
  context: string;
}

export interface GrammaticalCorrection {
  mistake: string;
  correction: string;
  explanation: string;
}

export interface SessionSummary {
  topics: string[];
  vocabulary: VocabularyItem[];
  corrections: GrammaticalCorrection[];
  strengths: string[];
  weaknesses: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  mode: TutorMode;
  messages: Message[];
  createdAt: number;
  dayIndex?: number;
  summary?: SessionSummary;
}

export interface AppState {
  messages: Message[];
  mode: TutorMode;
  isLoading: boolean;
  isVoiceActive: boolean;
}

export interface Transcription {
  text: string;
  role: 'user' | 'model';
}

