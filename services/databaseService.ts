
import { HistoricalSession, Question, MasteryCard, SRSState, StudyPlan, LifetimeStats } from '../types';

const DB_NAME = 'AbduGoatDB';
const DB_VERSION = 2;

export interface AppData {
  history: HistoricalSession[];
  bookmarks: Question[];
  masteryCards: Record<string, MasteryCard[]>;
  srsStates: Record<string, SRSState>;
  questionLibrary: Record<string, Question>;
  studyPlan: StudyPlan | null;
  lifetimeStats: LifetimeStats;
}

class DatabaseService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
        // Future schema migrations can be handled here
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async set(key: string, value: any): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['kv'], 'readwrite');
      const store = transaction.objectStore('kv');
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['kv'], 'readonly');
      const store = transaction.objectStore('kv');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // --- Core Persistence Functions ---

  async saveSession(session: HistoricalSession): Promise<LifetimeStats> {
    const history = await this.loadHistory();
    const updatedHistory = [session, ...history];
    await this.set('history', updatedHistory);
    return await this.updateAnalytics(updatedHistory);
  }

  async loadHistory(): Promise<HistoricalSession[]> {
    return await this.get<HistoricalSession[]>('history') || [];
  }

  async updateAnalytics(historyOverride?: HistoricalSession[]): Promise<LifetimeStats> {
    const history = historyOverride || await this.loadHistory();
    
    if (history.length === 0) {
      const empty: LifetimeStats = { totalQuestions: 0, totalCorrect: 0, totalHours: 0, avgAccuracy: 0, firstSessionDate: Date.now() };
      await this.set('lifetimeStats', empty);
      return empty;
    }

    const totalQuestions = history.reduce((acc, s) => acc + s.totalQuestions, 0);
    const totalCorrect = history.reduce((acc, s) => acc + s.correctAnswers, 0);
    const totalTimeMs = history.reduce((acc, s) => acc + s.timeTakenMs, 0);
    
    // Sort chronologically to find first session date
    const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
    const firstSessionDate = sortedHistory[0].timestamp;

    const stats: LifetimeStats = {
      totalQuestions,
      totalCorrect,
      totalHours: Number((totalTimeMs / 3600000).toFixed(1)),
      avgAccuracy: Math.round((totalCorrect / totalQuestions) * 100),
      firstSessionDate
    };

    await this.set('lifetimeStats', stats);
    return stats;
  }

  async backupAllData(): Promise<string> {
    const data = await this.getAllData();
    return JSON.stringify(data);
  }

  async fullImport(jsonData: string): Promise<boolean> {
    try {
      const data: AppData = JSON.parse(jsonData);
      
      // Strict validation
      if (!data || typeof data !== 'object') throw new Error("File content is not a valid JSON object");
      if (!Array.isArray(data.history)) throw new Error("Missing 'history' array in backup");
      if (!Array.isArray(data.bookmarks)) throw new Error("Missing 'bookmarks' array in backup");
      if (!data.questionLibrary) throw new Error("Missing 'questionLibrary' in backup");

      await this.set('history', data.history);
      await this.set('bookmarks', data.bookmarks);
      await this.set('masteryCards', data.masteryCards || {});
      await this.set('srsStates', data.srsStates || {});
      await this.set('questionLibrary', data.questionLibrary || {});
      await this.set('studyPlan', data.studyPlan || null);
      
      // Recalculate stats to ensure consistency
      await this.updateAnalytics(data.history);
      
      return true;
    } catch (e) {
      console.error("Import failed details:", e);
      alert(`Import Failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      return false;
    }
  }

  async getAllData(): Promise<AppData> {
    const history = await this.get<HistoricalSession[]>('history') || [];
    const bookmarks = await this.get<Question[]>('bookmarks') || [];
    const masteryCards = await this.get<Record<string, MasteryCard[]>>('masteryCards') || {};
    const srsStates = await this.get<Record<string, SRSState>>('srsStates') || {};
    const questionLibrary = await this.get<Record<string, Question>>('questionLibrary') || {};
    const studyPlan = await this.get<StudyPlan>('studyPlan') || null;
    let lifetimeStats = await this.get<LifetimeStats>('lifetimeStats');

    // Auto-migration: Calculate lifetime stats if missing but history exists
    if (!lifetimeStats) {
      if (history.length > 0) {
         lifetimeStats = await this.updateAnalytics(history);
      } else {
         lifetimeStats = { totalQuestions: 0, totalCorrect: 0, totalHours: 0, avgAccuracy: 0, firstSessionDate: Date.now() };
         await this.set('lifetimeStats', lifetimeStats);
      }
    }

    return { history, bookmarks, masteryCards, srsStates, questionLibrary, studyPlan, lifetimeStats };
  }
}

export const dbService = new DatabaseService();
