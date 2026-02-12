
import React, { useMemo, useState, useRef } from 'react';
import { HistoricalSession, Question, LifetimeStats, ClinicalComplexity } from '../types';
import { Button } from './Button';
import { PredictiveScore } from './PredictiveScore';
import { dbService } from '../services/databaseService';
import { 
  LineChart, Line, Tooltip, ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, BarChart, Bar, XAxis
} from 'recharts';

interface AnalyticsViewProps {
  history: HistoricalSession[];
  onClose: () => void;
  questionLibrary?: Record<string, Question>;
  lifetimeStats?: LifetimeStats;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ history, onClose, questionLibrary = {}, lifetimeStats }) => {
  const [sortMethod, setSortMethod] = useState<'weakness' | 'strength' | 'alpha'>('weakness');
  const [showDataModal, setShowDataModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use persisted lifetime stats if available, otherwise fallback to calculation
  const lifetime = useMemo<LifetimeStats | null>(() => {
    if (lifetimeStats) return lifetimeStats;
    if (history.length === 0) return null;
    
    const totalQuestions = history.reduce((acc, s) => acc + s.totalQuestions, 0);
    const totalCorrect = history.reduce((acc, s) => acc + s.correctAnswers, 0);
    const totalTimeMs = history.reduce((acc, s) => acc + s.timeTakenMs, 0);
    const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
    
    return {
      totalQuestions,
      totalCorrect,
      totalHours: Number((totalTimeMs / 3600000).toFixed(1)),
      avgAccuracy: Math.round((totalCorrect / totalQuestions) * 100),
      firstSessionDate: sorted[0].timestamp
    };
  }, [history, lifetimeStats]);

  const stats = useMemo(() => {
    if (history.length === 0 || !lifetime) return null;

    // Specialty Breakdown for Radar Chart
    const specialtyMap: Record<string, { correct: number, total: number }> = {};
    history.forEach(session => {
      session.specialties.forEach(spec => {
        const shortName = spec.split(' ')[0].substring(0, 10);
        if (!specialtyMap[shortName]) specialtyMap[shortName] = { correct: 0, total: 0 };
        specialtyMap[shortName].total += session.totalQuestions;
        specialtyMap[shortName].correct += session.correctAnswers;
      });
    });

    const radarData = Object.entries(specialtyMap).map(([name, data]) => ({
      subject: name,
      A: Math.round((data.correct / data.total) * 100),
      fullMark: 100
    })).slice(0, 6);

    // Exam Type Breakdown
    const examMap: Record<string, { correct: number, total: number }> = {};
    history.forEach(session => {
       session.examTypes.forEach(et => {
         if (!examMap[et]) examMap[et] = { correct: 0, total: 0 };
         examMap[et].total += session.totalQuestions;
         examMap[et].correct += session.correctAnswers;
       });
    });

    // Complexity Breakdown
    const complexityMap: Record<string, { correct: number, total: number }> = {};
    history.forEach(session => {
       if (session.complexity) {
          const comp = session.complexity;
          if (!complexityMap[comp]) complexityMap[comp] = { correct: 0, total: 0 };
          complexityMap[comp].total += session.totalQuestions;
          complexityMap[comp].correct += session.correctAnswers;
       }
    });
    
    const complexityData = Object.entries(complexityMap).map(([name, data]) => ({
       name,
       accuracy: Math.round((data.correct / data.total) * 100),
       total: data.total
    }));

    // Tag Analysis
    const tagStats: Record<string, { correct: number, total: number }> = {};
    history.forEach(session => {
      if (session.details) {
        session.details.forEach(detail => {
          const q = questionLibrary[detail.questionId];
          if (q && q.tags) {
            q.tags.forEach(tag => {
              if (!tagStats[tag]) tagStats[tag] = { correct: 0, total: 0 };
              tagStats[tag].total += 1;
              if (detail.isCorrect) tagStats[tag].correct += 1;
            });
          }
        });
      }
    });

    let subtopicData = Object.entries(tagStats).map(([name, data]) => ({
      name,
      accuracy: Math.round((data.correct / data.total) * 100),
      correct: data.correct,
      total: data.total
    }));

    if (sortMethod === 'weakness') subtopicData.sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
    else if (sortMethod === 'strength') subtopicData.sort((a, b) => b.accuracy - a.accuracy || b.total - a.total);
    else subtopicData.sort((a, b) => a.name.localeCompare(b.name));

    const timelineData = [...history].reverse().slice(0, 10).map((s, idx) => ({
      name: `S${idx + 1}`,
      accuracy: Math.round((s.correctAnswers / s.totalQuestions) * 100),
      date: new Date(s.timestamp).toLocaleDateString()
    }));
    
    // Activity Heatmap Data
    const activityMap: Record<string, number> = {};
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    // Populate map with 0s for all days
    for (let d = new Date(threeMonthsAgo); d <= new Date(); d.setDate(d.getDate() + 1)) {
        activityMap[d.toISOString().split('T')[0]] = 0;
    }
    
    // Fill with data
    history.forEach(s => {
        const day = new Date(s.timestamp).toISOString().split('T')[0];
        if (activityMap[day] !== undefined) {
            activityMap[day] += s.totalQuestions;
        }
    });
    
    const heatmapData = Object.entries(activityMap).map(([date, count]) => ({ date, count }));

    // Time Analysis
    const totalSeconds = lifetime.totalHours * 3600;
    const avgTimePerQuestionSec = Math.round(totalSeconds / lifetime.totalQuestions);

    return {
      sessionsCount: history.length,
      radarData,
      timelineData,
      subtopicData,
      examMap,
      complexityData,
      heatmapData,
      avgTimePerQuestionSec
    };
  }, [history, questionLibrary, sortMethod, lifetime]);

  const handleExport = async () => {
    try {
      const json = await dbService.backupAllData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `abdu_goat_backup_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      alert("Export failed");
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (confirm("WARNING: This will overwrite your current progress with the data from the file. Continue?")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target?.result;
        if (typeof text !== 'string') {
          alert("Failed to read file");
          return;
        }
        
        const success = await dbService.fullImport(text);
        if (success) {
          alert("Import successful! Reloading...");
          window.location.reload();
        } 
      };
      reader.onerror = () => alert("Error reading file");
      reader.readAsText(file);
    }
    // Reset input manually to allow re-selection of same file
    if (fileInputRef.current) fileInputRef.current.value = '';
    e.target.value = ''; 
  };

  if (!stats || !lifetime) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <div className="bg-slate-100 dark:bg-slate-800 p-8 rounded-[2rem] max-w-md">
          <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-2">No Data Yet</h2>
          <p className="text-slate-500 mb-6">Complete a session to generate insights.</p>
          <Button onClick={onClose}>Start Quiz</Button>
        </div>
      </div>
    );
  }

  const getBarColor = (accuracy: number) => {
    if (accuracy >= 70) return "bg-green-500";
    if (accuracy >= 50) return "bg-amber-400";
    return "bg-red-500";
  };
  
  const getHeatmapColor = (count: number) => {
      if (count === 0) return "bg-slate-100 dark:bg-slate-800";
      if (count < 10) return "bg-green-200 dark:bg-green-900/40";
      if (count < 30) return "bg-green-400 dark:bg-green-700";
      return "bg-green-600 dark:bg-green-500";
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">Analytics Board</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Lifetime Clinical Performance</p>
        </div>
        <div className="flex gap-2">
           <Button variant="secondary" onClick={() => setShowDataModal(true)}>Data Management</Button>
           <Button variant="outline" onClick={onClose} className="border-slate-200 dark:border-slate-700">Close</Button>
        </div>
      </div>

      <PredictiveScore history={history} subtopicData={stats.subtopicData} />

      {/* Metric Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">
           <div className="absolute right-0 top-0 p-4 opacity-10">
             <svg className="w-16 h-16 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.55-2.91l6.01-10.01-1.42-1.42-5.14 8.56-2.93-2.93-1.42 1.42 4.9 4.38z"/></svg>
           </div>
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Lifetime Acc.</p>
           <p className={`text-4xl font-black ${lifetime.avgAccuracy >= 70 ? 'text-green-500' : 'text-amber-500'}`}>{lifetime.avgAccuracy}%</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">
           <div className="absolute right-0 top-0 p-4 opacity-10">
             <svg className="w-16 h-16 text-indigo-600" fill="currentColor" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
           </div>
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Time / Question</p>
           <p className="text-4xl font-black text-slate-800 dark:text-slate-100">{stats.avgTimePerQuestionSec}<span className="text-lg text-slate-400 ml-1">s</span></p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">
           <div className="absolute right-0 top-0 p-4 opacity-10">
             <svg className="w-16 h-16 text-purple-600" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
           </div>
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Vignettes</p>
           <p className="text-4xl font-black text-slate-800 dark:text-slate-100">{lifetime.totalQuestions}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">
           <div className="absolute right-0 top-0 p-4 opacity-10">
              <svg className="w-16 h-16 text-cyan-600" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
           </div>
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Blocks</p>
           <p className="text-4xl font-black text-slate-800 dark:text-slate-100">{stats.sessionsCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar Chart for Specialties */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center min-h-[400px]">
           <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-2 w-full text-left">Specialty Shape</h3>
           <p className="text-xs text-slate-500 w-full text-left mb-4">Relative performance across major disciplines.</p>
           <div className="w-full h-[300px]">
             <ResponsiveContainer width="100%" height="100%">
               <RadarChart cx="50%" cy="50%" outerRadius="80%" data={stats.radarData}>
                 <PolarGrid stroke="#94a3b8" strokeOpacity={0.2} />
                 <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} />
                 <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                 <Radar name="Accuracy" dataKey="A" stroke="#3b82f6" strokeWidth={3} fill="#3b82f6" fillOpacity={0.3} />
                 <Tooltip />
               </RadarChart>
             </ResponsiveContainer>
           </div>
        </div>

        {/* Detailed List + Trend */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col h-[400px]">
           <div className="flex items-center justify-between mb-4">
             <div>
               <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">Trendline</h3>
               <p className="text-xs text-slate-500">Last 10 Blocks Accuracy.</p>
             </div>
           </div>
           <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.timelineData}>
                  <Line type="monotone" dataKey="accuracy" stroke="#8b5cf6" strokeWidth={3} dot={{ fill: '#8b5cf6', r: 4 }} activeDot={{ r: 6 }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '12px', color: 'white' }} 
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                </LineChart>
              </ResponsiveContainer>
           </div>
        </div>
      </div>
      
      {/* Activity Heatmap */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm">
         <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-4">Study Volume (Last 3 Months)</h3>
         <div className="flex flex-wrap gap-1">
            {stats.heatmapData.map((d, i) => (
               <div 
                 key={i} 
                 className={`w-3 h-3 rounded-sm ${getHeatmapColor(d.count)}`} 
                 title={`${d.date}: ${d.count} questions`}
               />
            ))}
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Knowledge Gap Analysis */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col h-[500px]">
           <div className="flex items-center justify-between mb-4">
             <div>
               <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">Micro-Analysis</h3>
               <p className="text-xs text-slate-500">Performance by granular subtopic tags.</p>
             </div>
             <div className="flex gap-2">
                <button onClick={() => setSortMethod('weakness')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-lg transition-colors ${sortMethod === 'weakness' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>Weakest</button>
                <button onClick={() => setSortMethod('strength')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-lg transition-colors ${sortMethod === 'strength' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>Strongest</button>
             </div>
           </div>
           <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
             {stats.subtopicData.map((topic, idx) => (
               <div key={idx} className="grid grid-cols-12 gap-2 items-center py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors px-1">
                  <div className="col-span-5 text-xs font-bold text-slate-700 dark:text-slate-200 truncate pr-2">{topic.name}</div>
                  <div className="col-span-5 flex items-center gap-3">
                     <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${getBarColor(topic.accuracy)}`} style={{ width: `${topic.accuracy}%` }} />
                     </div>
                     <span className={`text-xs font-black w-8 text-right ${topic.accuracy >= 70 ? 'text-green-600' : topic.accuracy >= 50 ? 'text-amber-500' : 'text-red-500'}`}>{topic.accuracy}%</span>
                  </div>
                  <div className="col-span-2 text-right text-xs font-bold text-slate-400">{topic.total}</div>
               </div>
             ))}
           </div>
        </div>

        {/* Complexity Split */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col h-[500px]">
           <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-4">Cognitive Complexity</h3>
           <div className="space-y-4 flex-1">
             {stats.complexityData.length > 0 ? stats.complexityData.map((data) => (
               <div key={data.name} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                 <div className="flex justify-between items-center mb-2">
                   <span className="text-xs font-black uppercase text-slate-500">{data.name}</span>
                   <span className={`text-sm font-black ${data.accuracy >= 70 ? 'text-green-500' : 'text-amber-500'}`}>{data.accuracy}%</span>
                 </div>
                 <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                    <div className={`h-full rounded-full ${getBarColor(data.accuracy)}`} style={{ width: `${data.accuracy}%` }} />
                 </div>
                 <p className="text-[10px] text-slate-400 font-medium">{data.total} Questions</p>
               </div>
             )) : (
                <div className="flex items-center justify-center h-full text-slate-400 text-xs italic">
                  No complexity data available yet.
                </div>
             )}
           </div>
        </div>
      </div>

      {/* Import/Export Modal */}
      {showDataModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 p-4">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg p-8 rounded-[2rem] shadow-2xl border border-slate-200 dark:border-slate-700 space-y-6 animate-in zoom-in-95 duration-200">
              <div className="text-center">
                 <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                   <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                 </div>
                 <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100">Data Vault</h3>
                 <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
                   Sync your progress across devices using secure file backup. Save the file to Google Drive to access it anywhere.
                 </p>
              </div>

              <div className="grid gap-4">
                 <button onClick={handleExport} className="flex items-center gap-4 p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border-2 border-transparent hover:border-blue-500 transition-all text-left group">
                    <div className="p-3 bg-blue-500 text-white rounded-xl shadow-md">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-800 dark:text-slate-100">Export Backup</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Download your entire history as a JSON file.</p>
                    </div>
                 </button>

                 <div className="relative group">
                    <input 
                      type="file" 
                      accept=".json"
                      ref={fileInputRef}
                      onChange={handleImport}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                      onClick={(e) => (e.target as HTMLInputElement).value = ''} // Ensure change event fires even if same file selected
                    />
                    <button className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-transparent group-hover:border-slate-400 transition-all text-left w-full z-10 relative">
                        <div className="p-3 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl shadow-md">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                        </div>
                        <div>
                          <p className="text-base font-bold text-slate-800 dark:text-slate-100">Import Backup</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Restore from a previously saved JSON file.</p>
                        </div>
                    </button>
                 </div>
              </div>

              <button 
                onClick={() => setShowDataModal(false)}
                className="w-full py-3 text-sm font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
           </div>
        </div>
      )}
    </div>
  );
};
