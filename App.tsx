
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MedicalSpecialty, ExamType, ClinicalComplexity, QuizSession, Question, HistoricalSession, SRSState, SRSRating, MasteryCard, StudyPlan, LifetimeStats } from './types';
import { generateQuestions, generateSimilarQuestions, generateMasteryCards, generateSessionSummary, generateStudyGuide } from './services/geminiService';
import { dbService } from './services/databaseService';
import { QuizSetup } from './components/QuizSetup';
import { QuestionCard } from './components/QuestionCard';
import { ResultsView } from './components/ResultsView';
import { BookmarksView } from './components/BookmarksView';
import { AnalyticsView } from './components/AnalyticsView';
import { SRSReview } from './components/SRSReview';
import { Button } from './components/Button';

// Extend Window interface for AI Studio helpers
declare global {
  interface AIStudio {
    openSelectKey: () => Promise<void>;
    hasSelectedApiKey: () => Promise<boolean>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

const App: React.FC = () => {
  const [view, setView] = useState<'setup' | 'quiz' | 'results' | 'bookmarks' | 'analytics' | 'srs'>('setup');
  const [isReady, setIsReady] = useState(false);
  
  // States
  const [session, setSession] = useState<QuizSession | null>(null);
  const [completedSession, setCompletedSession] = useState<QuizSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [backgroundProcessing, setBackgroundProcessing] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState(false);
  const [bookmarks, setBookmarks] = useState<Question[]>([]);
  const [masteryCards, setMasteryCards] = useState<Record<string, MasteryCard[]>>({});
  const [history, setHistory] = useState<HistoricalSession[]>([]);
  const [srsStates, setSrsStates] = useState<Record<string, SRSState>>({});
  const [questionLibrary, setQuestionLibrary] = useState<Record<string, Question>>({});
  const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats | undefined>(undefined);
  
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
             (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  // Database Initialization & Key Check
  useEffect(() => {
    const initData = async () => {
      await dbService.init();
      const data = await dbService.getAllData();
      
      setHistory(data.history);
      setBookmarks(data.bookmarks);
      setMasteryCards(data.masteryCards);
      setSrsStates(data.srsStates);
      setQuestionLibrary(data.questionLibrary);
      setStudyPlan(data.studyPlan);
      setLifetimeStats(data.lifetimeStats);

      // Restore active session from localStorage
      const savedSession = localStorage.getItem('abdu_active_session');
      if (savedSession) setSession(JSON.parse(savedSession));

      // Check API Key status
      if (window.aistudio) {
        const has = await window.aistudio.hasSelectedApiKey();
        setHasKey(has);
      }

      setIsReady(true);
    };
    initData();
  }, []);

  // Sync to Database on changes
  useEffect(() => { if (isReady) dbService.set('bookmarks', bookmarks); }, [bookmarks, isReady]);
  useEffect(() => { if (isReady) dbService.set('masteryCards', masteryCards); }, [masteryCards, isReady]);
  useEffect(() => { if (isReady) dbService.set('srsStates', srsStates); }, [srsStates, isReady]);
  useEffect(() => { if (isReady) dbService.set('questionLibrary', questionLibrary); }, [questionLibrary, isReady]);
  useEffect(() => { if (isReady) dbService.set('studyPlan', studyPlan); }, [studyPlan, isReady]);

  useEffect(() => {
    if (session) localStorage.setItem('abdu_active_session', JSON.stringify(session));
    else localStorage.removeItem('abdu_active_session');
  }, [session]);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  const toggleTheme = () => {
    const nextMode = !isDarkMode;
    setIsDarkMode(nextMode);
    localStorage.setItem('theme', nextMode ? 'dark' : 'light');
  };

  const handleError = async (error: any) => {
    const errorMsg = error?.message || JSON.stringify(error);
    const status = error?.status || error?.error?.code;

    // Handle 403 (Permission Denied) - Likely missing or invalid key
    if (status === 403 || errorMsg.includes("403") || errorMsg.includes("PERMISSION_DENIED")) {
      setHasKey(false);
      if (window.aistudio) {
        try {
          await window.aistudio.openSelectKey();
          setHasKey(true);
        } catch (e) {
          console.error("Key selection failed", e);
        }
      }
      alert("Permission Denied: Please select a valid API Key with Gemini API access enabled.");
      return;
    }

    // Handle 429 (Rate Limit)
    if (status === 429 || errorMsg.includes("429")) {
      setHasKey(false);
      alert("API Quota Reached. Please activate your key or wait 60s.");
      return;
    }

    console.error(error);
    if (isLoading) alert("API Error. Please try again.");
  };

  const addToLibrary = (questions: Question[]) => {
    setQuestionLibrary(prev => {
      const next = { ...prev };
      questions.forEach(q => { if (!next[q.id]) next[q.id] = q; });
      return next;
    });
  };

  const updateSRS = useCallback((cardId: string, rating: SRSRating) => {
    setSrsStates(prev => {
      const current = prev[cardId] || { cardId, nextReview: 0, interval: 0, ease: 2.3, repetitions: 0 };
      let { interval, ease, repetitions } = current;
      if (rating === 'again') {
        repetitions = 0;
        interval = 0;
        ease = Math.max(1.3, ease - 0.2);
      } else {
        if (repetitions === 0) interval = 1;
        else if (repetitions === 1) interval = 6;
        else interval = Math.ceil(interval * (rating === 'hard' ? 1.2 : rating === 'good' ? ease : ease * 1.5));
        repetitions += 1;
        if (rating === 'hard') ease = Math.max(1.3, ease - 0.15);
        if (rating === 'easy') ease += 0.15;
      }
      const nextReview = Date.now() + (interval * 24 * 60 * 60 * 1000);
      return { ...prev, [cardId]: { ...current, nextReview, interval, ease, repetitions } };
    });
  }, []);

  const toggleBookmark = (q: Question) => {
    const isAlreadyBookmarked = bookmarks.some(b => b.id === q.id);
    if (isAlreadyBookmarked) setBookmarks(prev => prev.filter(b => b.id !== q.id));
    else {
      setBookmarks(prev => [...prev, q]);
      addToLibrary([q]);
      setSrsStates(prev => {
        if (prev[q.id]) return prev;
        return { ...prev, [q.id]: { cardId: q.id, nextReview: Date.now(), interval: 0, ease: 2.3, repetitions: 0 } };
      });
    }
  };

  const dissectQuestion = async (q: Question) => {
    if (masteryCards[q.id]) return;
    try {
      const layers = await generateMasteryCards(q);
      setMasteryCards(prev => ({ ...prev, [q.id]: layers }));
      layers.forEach(card => updateSRS(card.id, 'again'));
    } catch (err) { handleError(err); }
  };

  const startQuiz = async (
    specialties: MedicalSpecialty[], 
    examTypes: ExamType[], 
    complexity: ClinicalComplexity, 
    count: number, 
    topics: string, 
    autoReinforce: boolean
  ) => {
    // Check Key Validation
    let currentHasKey = hasKey;
    if (window.aistudio) {
      currentHasKey = await window.aistudio.hasSelectedApiKey();
    }

    if (!currentHasKey) {
      if (window.aistudio) {
        try {
          await window.aistudio.openSelectKey();
          setHasKey(true);
        } catch (e) {
          console.error(e);
          return;
        }
      } else {
        setHasKey(true); // Fallback for dev environments without window.aistudio
      }
    }
    
    setIsLoading(true);
    try {
      const questions = await generateQuestions(specialties, examTypes, complexity, count, topics);
      if (questions.length === 0) throw new Error("Empty response");
      addToLibrary(questions);
      setSession({ 
        questions, 
        currentQuestionIndex: 0, 
        userAnswers: [], 
        startTime: Date.now(), 
        specialties, 
        examTypes, 
        complexity, 
        topics, 
        skippedIds: [],
        autoReinforce
      });
      setCompletedSession(null);
      setView('quiz');
    } catch (error) { handleError(error); } finally { setIsLoading(false); }
  };

  const handlePrev = () => {
    if (!session) return;
    if (session.currentQuestionIndex > 0) {
      const prevIdx = session.currentQuestionIndex - 1;
      setSession(prev => prev ? { ...prev, currentQuestionIndex: prevIdx } : null);
      setSelectedAnswer(session.userAnswers[prevIdx] ?? null);
    }
  };

  const handleNext = (userFocus?: string, manualReinforce?: boolean) => {
    if (!session || selectedAnswer === null) return;
    const currentIdx = session.currentQuestionIndex;
    const currentQuestion = session.questions[currentIdx];
    const isCorrect = selectedAnswer === currentQuestion.correctIndex;

    const updatedAnswers = [...session.userAnswers];
    updatedAnswers[currentIdx] = selectedAnswer;
    const shouldReinforce = manualReinforce || (!isCorrect && session.userAnswers[currentIdx] === undefined && session.autoReinforce);

    const nextIndex = currentIdx + 1;
    if (nextIndex < session.questions.length) {
      setSession(prev => prev ? { ...prev, currentQuestionIndex: nextIndex, userAnswers: updatedAnswers } : null);
      setSelectedAnswer(session.userAnswers[nextIndex] ?? null);
    } else {
      const finalSession = { ...session, userAnswers: updatedAnswers };
      // Process end of session
      processSessionCompletion(finalSession);
      
      setCompletedSession(finalSession);
      setSession(null);
      setView('results');
    }

    if (shouldReinforce) {
      setBackgroundProcessing(true);
      generateSimilarQuestions(currentQuestion, session.examTypes, session.complexity, 3, userFocus)
        .then(remediation => {
          if (remediation.length === 0) return;
          addToLibrary(remediation);
          setSession(prev => {
            if (!prev) return null;
            const updatedQuestions = [...prev.questions];
            remediation.forEach(newQ => { updatedQuestions.push(newQ); });
            return { ...prev, questions: updatedQuestions };
          });
        }).catch(err => console.error(err)).finally(() => setBackgroundProcessing(false));
    }
  };

  const processSessionCompletion = async (finalSession: QuizSession) => {
    const correctCount = finalSession.userAnswers.reduce((acc, ans, idx) => ans === finalSession.questions[idx].correctIndex ? acc + 1 : acc, 0);
    const accuracy = (correctCount / finalSession.questions.length) * 100;
    
    const details = finalSession.questions.map((q, idx) => ({
      questionId: q.id,
      isCorrect: finalSession.userAnswers[idx] === q.correctIndex
    }));

    const newHistoryEntry: HistoricalSession = {
      id: crypto.randomUUID(), 
      timestamp: Date.now(), 
      totalQuestions: finalSession.questions.length,
      correctAnswers: correctCount, 
      timeTakenMs: Date.now() - finalSession.startTime,
      specialties: finalSession.specialties, 
      examTypes: finalSession.examTypes,
      complexity: finalSession.complexity, // Save complexity for analysis
      details: details
    };
    
    // Update local state and Persist to DB
    setHistory(prev => [newHistoryEntry, ...prev]);
    const newLifetimeStats = await dbService.saveSession(newHistoryEntry);
    setLifetimeStats(newLifetimeStats);
  };

  const downloadTxt = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportGuide = async () => {
    if (!completedSession) return;
    setIsExporting(true);
    try {
      const textContent = await generateStudyGuide(completedSession.questions);
      downloadTxt(textContent, `Clinical_Study_Guide_${new Date().toISOString().slice(0,10)}.txt`);
    } catch (err) {
      console.error(err);
      alert("Failed to export study guide. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSummary = async () => {
    if (!completedSession) return;
    setIsExporting(true);
    try {
      const textContent = await generateSessionSummary(completedSession.questions);
      downloadTxt(textContent, `High_Yield_Summary_${new Date().toISOString().slice(0,10)}.txt`);
    } catch (err) {
      console.error(err);
      alert("Failed to export summary. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const dueSRSItems = useMemo(() => {
    const now = Date.now();
    const due = (Object.values(srsStates) as SRSState[]).filter(s => s.nextReview <= now);
    return due.map(s => {
      if (questionLibrary[s.cardId]) return { type: 'vignette' as const, data: questionLibrary[s.cardId] };
      for (const parentId in masteryCards) {
        const card = masteryCards[parentId].find(c => c.id === s.cardId);
        if (card) return { type: 'mastery' as const, data: card };
      }
      return null;
    }).filter(i => !!i);
  }, [srsStates, questionLibrary, masteryCards]);

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 font-black uppercase tracking-widest text-xs">Restoring Clinical Memory...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-slate-50 dark:bg-slate-950 transition-colors duration-300 overflow-x-hidden">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 cursor-pointer" onClick={() => setView('setup')} role="button">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg sm:rounded-xl flex items-center justify-center text-white font-bold shadow-lg">A</div>
            <h1 className="text-sm sm:text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">Abdu is the goat</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
             <button onClick={() => setView('analytics')} className={`p-2 rounded-xl ${view === 'analytics' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-slate-800'}`}>📊</button>
             <button onClick={() => setView('bookmarks')} className={`p-2 rounded-xl border-2 transition-all ${view === 'bookmarks' ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-blue-600 hover:border-blue-200'}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
             </button>
             <button onClick={() => setView('srs')} className={`p-2 rounded-xl relative ${view === 'srs' ? 'bg-amber-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-slate-800'}`}>
               {dueSRSItems.length > 0 && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full text-[8px] flex items-center justify-center text-white">{dueSRSItems.length}</span>}
               🗃️
             </button>
             <button onClick={toggleTheme} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">{isDarkMode ? '🌞' : '🌙'}</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        {view === 'setup' && (
          <QuizSetup onStart={startQuiz} isLoading={isLoading} dueSRSCount={dueSRSItems.length} onStartSRS={() => setView('srs')} onResume={() => setView('quiz')} onDiscardSession={() => setSession(null)} activeSessionProgress={session ? { current: session.currentQuestionIndex + 1, total: session.questions.length, skippedCount: session.skippedIds?.length || 0 } : undefined} />
        )}

        {view === 'quiz' && session && (
          <QuestionCard 
            question={session.questions[session.currentQuestionIndex]} 
            selectedAnswer={selectedAnswer} 
            onAnswer={setSelectedAnswer} 
            onNext={handleNext} 
            onPrev={handlePrev}
            isLast={session.currentQuestionIndex === session.questions.length - 1} 
            isFirst={session.currentQuestionIndex === 0} 
            onToggleBookmark={() => toggleBookmark(session.questions[session.currentQuestionIndex])}
            isBookmarked={bookmarks.some(b => b.id === session.questions[session.currentQuestionIndex].id)}
            progress={(session.currentQuestionIndex / session.questions.length) * 100} 
            currentIndex={session.currentQuestionIndex} 
            totalQuestions={session.questions.length} 
            autoReinforce={session.autoReinforce} 
            onDissect={dissectQuestion} 
            masteryCards={masteryCards[session.questions[session.currentQuestionIndex].id]} 
          />
        )}

        {view === 'results' && completedSession && (
          <ResultsView session={completedSession} onRestart={() => setView('setup')} onViewAnalytics={() => setView('analytics')} onViewBookmarks={() => setView('bookmarks')} onExportGuide={handleExportGuide} onExportSummary={handleExportSummary} isExporting={isExporting} />
        )}

        {view === 'analytics' && <AnalyticsView history={history} onClose={() => setView('setup')} questionLibrary={questionLibrary} lifetimeStats={lifetimeStats} />}
        {view === 'srs' && <SRSReview questions={dueSRSItems} onRate={updateSRS} onClose={() => setView('setup')} />}
        {view === 'bookmarks' && <BookmarksView bookmarks={bookmarks} onClose={() => setView('setup')} onRemove={toggleBookmark} masteryLayers={masteryCards} onDissect={dissectQuestion} />}
      </main>
    </div>
  );
};

export default App;
