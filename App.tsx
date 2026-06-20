import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TutorMode, Message, ChatSession, SessionSummary } from './types';
import { getGeminiResponse, generateSessionSummary } from './services/geminiService';
import ChatMessage from './components/ChatMessage';
import VoiceInterface from './components/VoiceInterface';
import { CURRICULUM_DATA } from './constants';
import { 
  MessageSquare, BookOpen, Plus, Trash2, Edit2, 
  Check, X, Sparkles, Menu, Brain, Award, 
  ChevronRight, ChevronLeft, BookMarked 
} from 'lucide-react';

const STORAGE_KEY = 'aura_ai_v2_history';

const App: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'notebook'>('sessions');
  const [currentDay, setCurrentDay] = useState(() => {
    const saved = localStorage.getItem('aura_current_day');
    return saved ? parseInt(saved) : 1;
  });

  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('aura_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.error(e);
      }
    }
    const savedOld = localStorage.getItem(STORAGE_KEY);
    const oldMsgs = savedOld ? JSON.parse(savedOld) : [
      {
        id: 'welcome',
        role: 'model',
        content: "Hi there! I'm **Aura**, your private English guide. I've analyzed our past sessions to personalize today's practice. Shall we start?",
        timestamp: Date.now()
      }
    ];
    return [
      {
        id: 'default_session',
        title: 'Hội thoại ban đầu',
        mode: (localStorage.getItem('aura_current_mode') as TutorMode) || TutorMode.CONVERSATION,
        messages: oldMsgs,
        createdAt: Date.now()
      }
    ];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const saved = localStorage.getItem('aura_active_session_id');
    return (saved && sessions.some(s => s.id === saved)) ? saved : (sessions[0]?.id || 'default_session');
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('aura_sessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('aura_active_session_id', activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem('aura_current_day', currentDay.toString());
  }, [currentDay]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0] || {
    id: 'fallback',
    title: 'Hội thoại',
    mode: TutorMode.CONVERSATION,
    messages: []
  };

  const messages = activeSession.messages;
  const mode = activeSession.mode;

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  const getDayGoal = (dayIdx: number) => {
    const weeks = Object.values(CURRICULUM_DATA);
    for (const w of weeks) {
      const foundDay = w.days.find(d => d.day === dayIdx);
      if (foundDay) return foundDay;
    }
    return { day: dayIdx, goal: "Daily Practice", keywords: [] };
  };

  const activeDayInfo = getDayGoal(currentDay);

  const handleModeSelect = (newMode: TutorMode) => {
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        let title = s.title;
        if (s.title === 'Hội thoại ban đầu' || s.title.startsWith('Hội thoại')) {
          const l = newMode === TutorMode.CONVERSATION ? 'Casual' : newMode === TutorMode.IELTS ? 'IELTS' : '30-Day';
          title = `${l} ${new Date(s.createdAt).toLocaleDateString('vi', { month: '2-digit', day: '2-digit' })}`;
        }
        return { ...s, mode: newMode, title };
      }
      return s;
    }));
  };

  const handleNewSession = (selectedMode: TutorMode = TutorMode.CONVERSATION) => {
    const newId = Date.now().toString();
    const l = selectedMode === TutorMode.CONVERSATION ? 'Casual' : selectedMode === TutorMode.IELTS ? 'IELTS' : '30-Day';
    const dayTag = selectedMode === TutorMode.TUTOR_30_DAYS ? ` - Day ${currentDay}` : '';

    const welcome = selectedMode === TutorMode.CONVERSATION 
      ? "Hi there! I'm **Aura**, your private English guide. Let's start our friendly conversation. What's on your mind today?"
      : selectedMode === TutorMode.IELTS
      ? "Welcome to your IELTS Speaking assessment. I will act as your examiner today. Let's do a short introduction. Tell me, do you work or are you a student?"
      : `Hello! Welcome back to Day ${currentDay} of your 30-day transformation. Today's target goal is: **${activeDayInfo.goal}**. Let's practice. Introduce yourself in English!`;

    const newSession: ChatSession = {
      id: newId,
      title: `${l}${dayTag} ${new Date().toLocaleDateString('vi', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
      mode: selectedMode,
      messages: [{ id: 'welcome_' + newId, role: 'model', content: welcome, timestamp: Date.now() }],
      createdAt: Date.now()
    };

    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    setSidebarTab('sessions');
  };

  const handleDeleteSession = (id: string) => {
    if (sessions.length <= 1) return;
    const remaining = sessions.filter(s => s.id !== id);
    setSessions(remaining);
    if (activeSessionId === id) setActiveSessionId(remaining[0].id);
  };

  const handleSaveRename = (id: string) => {
    if (!renameValue.trim()) return;
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: renameValue.trim() } : s));
    setRenamingId(null);
  };

  const handleGenerateSummary = async () => {
    if (isSummarizing || messages.length < 2) return;
    setIsSummarizing(true);
    try {
      const summary = await generateSessionSummary(messages);
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, summary } : s));
      setSidebarTab('notebook');
    } catch (e) {
      console.error(e);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now()
    };

    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: [...s.messages, userMsg] } : s));
    setInput('');
    setIsLoading(true);

    try {
      const history = messages.slice(-30);
      const resText = await getGeminiResponse(userMsg.content, mode, [...history, userMsg], currentDay, activeDayInfo.goal);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: resText,
        timestamp: Date.now()
      };
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: [...s.messages, aiMsg] } : s));
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden relative font-sans w-screen">
      {isVoiceActive && (
        <VoiceInterface 
          mode={mode} 
          onClose={() => setIsVoiceActive(false)} 
          onModeChange={handleModeSelect}
          currentDay={currentDay}
          dayGoal={activeDayInfo.goal}
        />
      )}

      {isSidebarOpen && (
        <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-slate-950/25 backdrop-blur-xs z-25 lg:hidden" />
      )}

      {/* Left Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-80 bg-white border-r border-slate-100 flex flex-col transition-transform duration-300 lg:static lg:translate-x-0 ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } ${isSidebarOpen ? 'lg:flex' : 'lg:hidden'} shadow-xl lg:shadow-none shrink-0 h-full`}>
        
        <div className="p-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-slate-900 to-black rounded-lg flex items-center justify-center text-white font-black shadow-md shadow-slate-100">A</div>
            <div>
              <h2 className="font-extrabold text-slate-900 text-sm tracking-tight leading-none text-left">Aura Workspace</h2>
              <span className="text-[9px] uppercase tracking-wider font-extrabold text-pink-500 mt-1 block text-left">Sổ Tay Ghi Nhớ & Lịch Sử</span>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-1.5 hover:bg-slate-50 rounded-lg lg:hidden text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Sidebar Tabs */}
        <div className="flex border-b border-slate-100 p-2 bg-slate-50/50 shrink-0">
          <button 
            onClick={() => setSidebarTab('sessions')} 
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-black rounded-lg transition-all ${
              sidebarTab === 'sessions' ? 'bg-white text-slate-900 shadow-xs border border-slate-100' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <MessageSquare size={13} />
            Hội thoại
          </button>
          <button 
            onClick={() => setSidebarTab('notebook')} 
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-black rounded-lg transition-all relative ${
              sidebarTab === 'notebook' ? 'bg-white text-slate-900 shadow-xs border border-slate-100' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <BookMarked size={13} />
            Sổ tay ghi nhớ
            {activeSession.summary && <span className="absolute top-1.5 right-2 w-1.5 h-1.5 bg-pink-500 rounded-full animate-ping" />}
          </button>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {sidebarTab === 'sessions' ? (
            <div className="space-y-3">
              <button 
                onClick={() => handleNewSession(mode)}
                className="w-full py-2 px-4 bg-gradient-to-r from-pink-500 to-rose-600 text-white rounded-xl text-xs font-black hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg shadow-pink-100 cursor-pointer"
              >
                <Plus size={14} strokeWidth={3} />
                CUỘC HỘI THOẠI MỚI
              </button>

              <div className="space-y-1.5">
                {sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const isRenaming = renamingId === session.id;

                  return (
                    <div 
                      key={session.id}
                      className={`group relative rounded-xl border p-3 flex flex-col gap-1 transition-all ${
                        isActive ? 'bg-slate-50 border-pink-100 shadow-xs' : 'bg-white border-slate-100 hover:bg-slate-50/50 hover:border-slate-200'
                      }`}
                    >
                      <div 
                        className="absolute inset-0 cursor-pointer z-0 rounded-xl"
                        onClick={() => {
                          if (!isRenaming) {
                            setActiveSessionId(session.id);
                            if (window.innerWidth < 1024) setIsSidebarOpen(false);
                          }
                        }}
                      />

                      <div className="flex items-center justify-between z-10 relative">
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                          session.mode === TutorMode.CONVERSATION ? 'bg-pink-100 text-pink-700' : session.mode === TutorMode.IELTS ? 'bg-rose-100 text-rose-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {session.mode === TutorMode.CONVERSATION ? 'Casual' : session.mode === TutorMode.IELTS ? 'IELTS' : '30D'}
                        </span>
                        <span className="text-[9px] font-medium text-slate-400">
                          {new Date(session.createdAt).toLocaleDateString('vi', { month: '2-digit', day: '2-digit' })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1 z-10 relative mt-1">
                        {isRenaming ? (
                          <div className="flex items-center gap-1 w-full bg-white border border-slate-200 rounded-lg p-0.5 shadow-inner">
                            <input 
                              type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' ? handleSaveRename(session.id) : e.key === 'Escape' ? setRenamingId(null) : null}
                              className="w-full text-xs bg-transparent border-none p-1 focus:outline-none focus:ring-0 text-slate-800 font-semibold" autoFocus
                            />
                            <button onClick={() => handleSaveRename(session.id)} className="p-1 text-green-600"><Check size={12} strokeWidth={3} /></button>
                            <button onClick={() => setRenamingId(null)} className="p-1 text-slate-400"><X size={12} strokeWidth={3} /></button>
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-slate-800 line-clamp-1 flex-1 text-left">
                            {session.title}
                          </span>
                        )}

                        {!isRenaming && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center bg-slate-50 border border-slate-100 shadow-xs rounded-lg py-0.5 px-0.5 gap-1 shrink-0">
                            <button 
                              onClick={(e) => { e.stopPropagation(); setRenamingId(session.id); setRenameValue(session.title); }}
                              className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-800 transition-colors"
                            >
                              <Edit2 size={11} />
                            </button>
                            {sessions.length > 1 && (
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                                className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-700 transition-colors"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Tab Ghi nhớ (Learning summary) */
            <div className="space-y-4">
              {activeSession.summary ? (
                <div className="space-y-4 text-slate-800 text-left">
                  <div className="bg-gradient-to-r from-pink-50 to-rose-50 rounded-xl p-3 border border-pink-100">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Brain size={14} className="text-pink-600" />
                      <h3 className="text-xs font-black uppercase text-pink-900 tracking-wider">Chủ đề thảo luận</h3>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {activeSession.summary.topics.map((topic, i) => (
                        <span key={i} className="text-[10px] font-bold bg-white text-slate-700 px-2 py-0.5 rounded-md border border-slate-100 shadow-xs">{topic}</span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-2 shadow-xs">
                      <span className="text-lg font-black text-pink-600">{activeSession.summary.vocabulary.length}</span>
                      <p className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">Từ vựng mới</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-2 shadow-xs">
                      <span className="text-lg font-black text-rose-600">{activeSession.summary.corrections.length}</span>
                      <p className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">Grammar Sửa lỗi</p>
                    </div>
                  </div>

                  {/* Vocabulary list */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 pb-1 border-b border-slate-100">
                      <BookOpen size={13} className="text-pink-600" />
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Từ vựng ghi nhận</h4>
                    </div>
                    {activeSession.summary.vocabulary.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">Chưa ghi nhận từ nổi bật.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {activeSession.summary.vocabulary.map((v, i) => (
                          <div key={i} className="bg-white border border-slate-100 rounded-xl p-2.5 shadow-xs">
                            <span className="text-xs font-black text-pink-600 block">{v.word}</span>
                            <span className="text-[10px] font-semibold text-slate-600 block">{v.meaning}</span>
                            <span className="text-[9px] font-mono italic text-slate-400 block bg-slate-50 px-2 py-1 rounded border border-slate-100/50 mt-1 leading-normal">&ldquo;{v.context}&rdquo;</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Grammar Corrections */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 pb-1 border-b border-slate-100">
                      <Sparkles size={13} className="text-rose-600" />
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider font-bold">Lỗi sai & Sửa đổi</h4>
                    </div>
                    {activeSession.summary.corrections.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">Phiên này không phát hiện lỗi sai lặp lại.</p>
                    ) : (
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {activeSession.summary.corrections.map((c, i) => (
                          <div key={i} className="bg-white border border-slate-100 rounded-xl p-2.5 shadow-xs space-y-1">
                            <div>
                              <span className="text-[8px] font-black bg-red-100 text-red-700 px-1 py-0.5 rounded uppercase tracking-wider">Lỗi chưa đúng</span>
                              <p className="text-[10.5px] font-bold text-red-800 line-through mt-0.5">{c.mistake}</p>
                            </div>
                            <div>
                              <span className="text-[8px] font-black bg-green-100 text-green-700 px-1 py-0.5 rounded uppercase tracking-wider">Aura khuyên dùng</span>
                              <p className="text-[10.5px] font-black text-green-800 mt-0.5">{c.correction}</p>
                            </div>
                            <p className="text-[9px] text-slate-500 p-1 bg-slate-50 rounded mt-1">{c.explanation}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Overall Feedback */}
                  <div className="space-y-2 bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 border-b border-slate-200/50 pb-1.5">
                      <Award size={13} className="text-yellow-600" />
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Aura Nhận xét</h4>
                    </div>
                    <div className="space-y-1.5 text-[10.5px] mt-2">
                      {activeSession.summary.strengths.length > 0 && (
                        <div>
                          <span className="font-extrabold text-green-700 block text-[10px]">✓ Điểm mạnh:</span>
                          <ul className="list-disc pl-3 text-slate-600 mt-0.5 space-y-0.5">
                            {activeSession.summary.strengths.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                      {activeSession.summary.weaknesses.length > 0 && (
                        <div className="pt-1">
                          <span className="font-extrabold text-rose-700 block text-[10px]">⚠ Cần lưu ý:</span>
                          <ul className="list-disc pl-3 text-slate-600 mt-0.5 space-y-0.5">
                            {activeSession.summary.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>

                  <button 
                    onClick={handleGenerateSummary} disabled={isSummarizing || messages.length < 2}
                    className="w-full mt-2 py-2 bg-slate-900 text-white hover:bg-black font-extrabold rounded-xl text-[10px] active:scale-95 transition-all text-center flex items-center justify-center gap-2 cursor-pointer uppercase tracking-widest disabled:opacity-50"
                  >
                    {isSummarizing ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Sparkles size={11} className="animate-pulse text-yellow-300" />
                    )}
                    CẬP NHẬT GHI NHỚ
                  </button>
                </div>
              ) : (
                <div className="text-center py-10 px-4 flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 bg-pink-50 text-pink-600 rounded-2xl flex items-center justify-center border border-pink-100 shadow-xs animate-pulse">
                    <Brain size={24} />
                  </div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">Chưa có ghi nhớ</h3>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs block text-center">
                    Hãy chat ít nhất 2 câu và nhấp tổng kết dưới đây để Aura trích xuất từ vựng mới và lỗi ngữ pháp vào sổ tay nhé!
                  </p>
                  <button 
                    onClick={handleGenerateSummary} disabled={isSummarizing || messages.length < 2}
                    className="w-full mt-2 py-2.5 bg-gradient-to-r from-pink-500 to-rose-600 text-white hover:opacity-90 font-black rounded-xl text-xs active:scale-95 transition-all text-center flex items-center justify-center gap-2 shadow-lg shadow-pink-100 cursor-pointer disabled:opacity-50"
                  >
                    {isSummarizing ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Sparkles size={13} className="text-yellow-200" />
                    )}
                    {isSummarizing ? 'ĐANG TỔNG HỢP...' : 'TỔNG HỢP GHI NHỚ'}
                  </button>
                  {messages.length < 2 && <span className="text-[8px] font-bold text-slate-400 italic">Trò chuyện thêm với Aura để mở khóa</span>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-100 text-[9px] font-black text-slate-400 text-center uppercase tracking-widest shrink-0">
          AuraAI Personal Memory
        </div>
      </aside>

      {/* Main Panel Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10 bg-slate-50">
        
        <header className="bg-white/85 backdrop-blur-md border-b border-slate-100 px-4 py-4 flex items-center justify-between shadow-xs sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors cursor-pointer block"
              title="Mở thanh ghi nhớ"
            >
              <Menu size={20} strokeWidth={2.5} />
            </button>
            <div className="flex items-center gap-2">
              <div className="hidden xs:flex w-10 h-10 bg-gradient-to-br from-slate-900 to-black rounded-xl items-center justify-center text-white font-black shadow-lg">A</div>
              <div className="text-left">
                <h1 className="font-extrabold text-slate-950 text-base sm:text-lg tracking-tight leading-none">AuraAI</h1>
                <p className="text-[10px] text-pink-600 font-extrabold uppercase tracking-widest mt-1">Adaptive Personal Tutor</p>
              </div>
            </div>
          </div>

          {activeSession.summary && (
            <button 
              onClick={() => { setSidebarTab('notebook'); setIsSidebarOpen(true); }}
              className="hidden md:flex items-center gap-1.5 bg-pink-50 border border-pink-100 hover:bg-pink-100 transition-colors px-3 py-1.5 rounded-full text-[10px] font-black text-pink-700 uppercase tracking-widest"
            >
              <Brain size={12} className="text-pink-600 animate-pulse" />
              Sổ tay thông thái sẵn sàng 📝
            </button>
          )}

          <button onClick={() => setIsVoiceActive(true)} className="bg-slate-950 text-white px-4 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-black hover:bg-black transition-all active:scale-95 flex items-center gap-2 shadow-xl shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
            TALK NOW
          </button>
        </header>

        {/* Mode Selector and Day navigation */}
        <div className="bg-white border-b border-slate-100 py-3 px-4 flex flex-col sm:flex-row items-center justify-between gap-3 z-10 shadow-xs shrink-0">
          <div className="flex gap-1 shrink-0">
            <button onClick={() => handleModeSelect(TutorMode.CONVERSATION)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all border ${mode === TutorMode.CONVERSATION ? 'bg-pink-600 text-white border-pink-600 shadow-xs' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'}`}>Casual</button>
            <button onClick={() => handleModeSelect(TutorMode.IELTS)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all border ${mode === TutorMode.IELTS ? 'bg-rose-600 text-white border-rose-600 shadow-xs' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'}`}>IELTS</button>
            <button onClick={() => handleModeSelect(TutorMode.TUTOR_30_DAYS)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all border ${mode === TutorMode.TUTOR_30_DAYS ? 'bg-orange-600 text-white border-orange-600 shadow-xs' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'}`}>30 Days</button>
          </div>

          {mode === TutorMode.TUTOR_30_DAYS && (
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl border border-slate-100 p-1 shrink-0">
              <button 
                onClick={() => setCurrentDay(Math.max(1, currentDay - 1))} disabled={currentDay === 1}
                className="p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30 rounded-lg cursor-pointer"
              >
                <ChevronLeft size={14} strokeWidth={2.5} />
              </button>
              <div className="flex flex-col text-right">
                <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest leading-none">DAY {currentDay}/30</span>
                <span className="text-[9px] font-bold text-slate-500 line-clamp-1 mt-0.5 max-w-[150px]">{activeDayInfo.goal}</span>
              </div>
              <button 
                onClick={() => setCurrentDay(Math.min(30, currentDay + 1))} disabled={currentDay === 30}
                className="p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30 rounded-lg cursor-pointer"
              >
                <ChevronRight size={14} strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>

        {/* Message body */}
        <main ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:px-12 lg:px-20 xl:px-28 relative z-10 space-y-2 pb-32">
          <div className="text-center py-4 select-none">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-4 py-1.5 rounded-full shadow-xs border border-slate-200/50">
              ⚡ Aura tự động ghi nhớ thói quen giao tiếp để đúc kết bài học
            </span>
          </div>

          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <Brain className="w-12 h-12 text-slate-300 mb-2 animate-pulse" />
              <p className="text-xs font-semibold uppercase tracking-wider">Hội thoại trống</p>
              <p className="text-[11px] mt-1">Hãy nhập nội dung để bắt đầu rèn luyện cùng Aura!</p>
            </div>
          ) : (
            messages.map(msg => <ChatMessage key={msg.id} message={msg} />)
          )}

          {isLoading && (
            <div className="flex items-center gap-2 p-3 bg-white border border-slate-150 rounded-2xl w-fit shadow-md ml-4">
              <div className="w-1.5 h-1.5 bg-pink-500 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-pink-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              <span className="text-[10px] font-black text-slate-400 uppercase">Aura is thinking...</span>
            </div>
          )}
        </main>

        {/* Absolute fluid footer */}
        <footer className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent px-4 pb-8 pt-4 z-20 flex justify-center pointer-events-none">
          <div className="relative w-full max-w-2xl mx-auto flex gap-3 items-center bg-white p-2 rounded-2xl shadow-xl border border-slate-200 pointer-events-auto">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
              placeholder="Nhập tin nhắn tiếng Anh..."
              className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none px-4 py-2 resize-none text-xs sm:text-[14px] font-medium placeholder:text-slate-300 min-h-[44px] max-h-32 text-slate-800"
            />
            {messages.length >= 2 && (
              <button 
                onClick={() => {
                  setSidebarTab('notebook');
                  setIsSidebarOpen(true);
                  if (!activeSession.summary) handleGenerateSummary();
                }}
                className="p-3 text-slate-400 hover:text-pink-500 hover:bg-slate-50 rounded-xl transition-colors"
                title="Bật Sổ tay học tập"
              >
                <Brain size={18} />
              </button>
            )}
            <button 
              onClick={handleSendMessage}
              disabled={!input.trim() || isLoading}
              className={`p-3.5 rounded-xl transition-all shadow-lg active:scale-95 disabled:pointer-events-none cursor-pointer ${
                input.trim() ? 'bg-slate-950 text-white hover:bg-black' : 'bg-slate-50 text-slate-200 shadow-none'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
};

export default App;
