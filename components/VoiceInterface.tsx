import React, { useEffect, useRef, useState, useCallback } from 'react';
import { LiveServerMessage } from '@google/genai';
import { TutorMode } from '../types';
import { SYSTEM_INSTRUCTIONS } from '../constants';

interface VoiceInterfaceProps {
  mode: TutorMode;
  onClose: () => void;
  onModeChange: (newMode: TutorMode) => void;
  currentDay?: number;
  dayGoal?: string;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

const VoiceInterface: React.FC<VoiceInterfaceProps> = ({
  mode: initialMode,
  onClose,
  onModeChange,
  currentDay = 1,
  dayGoal = "Self-introduction"
}) => {
  const [currentMode, setCurrentMode] = useState<TutorMode>(initialMode);
  const [status, setStatus] = useState<'connecting' | 'active' | 'error'>('connecting');
  const [userTranscription, setUserTranscription] = useState('');
  const [modelTranscription, setModelTranscription] = useState('');
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isHoldToTalk, setIsHoldToTalk] = useState(true);
  const [isPressing, setIsPressing] = useState(false);
  const [userRms, setUserRms] = useState(0);

  const sessionRef = useRef<any>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  // Ref lưu stream để tắt mic hoàn toàn khi đóng
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const isHoldToTalkRef = useRef(true);
  const isPressingRef = useRef(false);
  const lastSpeechTimeRef = useRef(0);
  const hasSpokenActiveRef = useRef(false);

  useEffect(() => { isHoldToTalkRef.current = isHoldToTalk; }, [isHoldToTalk]);
  useEffect(() => { isPressingRef.current = isPressing; }, [isPressing]);

  // Cleanup hoàn toàn: dừng mic, đóng WebSocket, đóng AudioContext
  const cleanup = useCallback(() => {
    // Dừng tất cả audio tracks — tắt đèn mic trên trình duyệt
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    // Disconnect processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Đóng WebSocket
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }

    // Dừng các audio đang phát
    sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    // Đóng AudioContext
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close();
      outputAudioCtxRef.current = null;
    }
  }, []);

  const startSession = useCallback(async (mode: TutorMode) => {
    cleanup();
    setStatus('connecting');

    try {
      // Xin quyền mic và lưu stream vào ref
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        }
      });
      micStreamRef.current = stream; // Lưu để cleanup sau

      inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const gainNode = inputAudioCtxRef.current.createGain();
      gainNode.gain.value = 2.5;

      const lowCutFilter = inputAudioCtxRef.current.createBiquadFilter();
      lowCutFilter.type = 'highpass';
      lowCutFilter.frequency.value = 80;

      const highCutFilter = inputAudioCtxRef.current.createBiquadFilter();
      highCutFilter.type = 'lowpass';
      highCutFilter.frequency.value = 4000;

      const analyserNode = inputAudioCtxRef.current.createAnalyser();
      analyserNode.fftSize = 256;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws?mode=${mode}&currentDay=${currentDay}&dayGoal=${encodeURIComponent(dayGoal)}`;
      const ws = new WebSocket(wsUrl);
      sessionRef.current = ws;

      ws.onopen = () => {
        setStatus('active');
        const source = inputAudioCtxRef.current!.createMediaStreamSource(stream);
        const processor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        source.connect(lowCutFilter);
        lowCutFilter.connect(highCutFilter);
        highCutFilter.connect(gainNode);
        gainNode.connect(analyserNode);
        analyserNode.connect(processor);
        processor.connect(inputAudioCtxRef.current!.destination);

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);

          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
          const rms = Math.sqrt(sum / inputData.length);
          setUserRms(Math.min(100, Math.floor(rms * 1200)));

          if (isHoldToTalkRef.current && !isPressingRef.current) return;

          if (rms > 0.004) {
            if (!hasSpokenActiveRef.current) hasSpokenActiveRef.current = true;
            lastSpeechTimeRef.current = Date.now();
          } else {
            if (!isHoldToTalkRef.current && hasSpokenActiveRef.current) {
              const silentMs = Date.now() - lastSpeechTimeRef.current;
              if (silentMs > 2000) {
                hasSpokenActiveRef.current = false;
                if (ws && ws.readyState === WebSocket.OPEN) {
                  try {
                    ws.send(JSON.stringify({ clientContent: { turnComplete: true } }));
                  } catch (err) {
                    console.warn("Auto turnComplete failed:", err);
                  }
                }
              }
            }
          }

          const int16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const sample = Math.max(-1, Math.min(1, inputData[i]));
            int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          }

          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              realtimeInput: { mediaChunks: [{ data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' }] }
            }));
          }
        };
      };

      ws.onmessage = async (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === "message") {
            const message = parsed.message as LiveServerMessage;
            if (message.serverContent?.inputTranscription) {
              setUserTranscription(prev => prev + ' ' + message.serverContent!.inputTranscription!.text);
            }
            if (message.serverContent?.outputTranscription) {
              setModelTranscription(prev => prev + message.serverContent!.outputTranscription!.text);
            }
            if (message.serverContent?.turnComplete) {
              setUserTranscription('');
              setModelTranscription('');
              hasSpokenActiveRef.current = false;
            }

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioCtxRef.current) {
              setIsAiSpeaking(true);
              const ctx = outputAudioCtxRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsAiSpeaking(false);
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsAiSpeaking(false);
            }
          } else if (parsed.type === "error") {
            console.error("WebSocket error:", parsed.error);
            setStatus('error');
          }
        } catch (err) {
          console.error("Error handling ws message:", err);
        }
      };

      ws.onerror = (e) => {
        console.error("WebSocket error:", e);
        setStatus('error');
      };

      ws.onclose = () => {
        console.log("WebSocket closed.");
      };

    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  }, [cleanup, currentDay, dayGoal]);

  // Auto-start khi component mount
  useEffect(() => {
    startSession(currentMode);
    // Cleanup khi component unmount (thoát voice mode)
    return () => {
      cleanup();
    };
  }, [currentMode, startSession, cleanup]);

  // Hàm đóng: cleanup mic rồi mới gọi onClose
  const handleClose = useCallback(() => {
    cleanup();
    onClose();
  }, [cleanup, onClose]);

  const handleModeSwitch = (newMode: TutorMode) => {
    if (newMode !== currentMode) {
      setCurrentMode(newMode);
      onModeChange(newMode);
    }
  };

  const handlePressStart = () => {
    if (isAiSpeaking) {
      sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
      sourcesRef.current.clear();
      nextStartTimeRef.current = 0;
      setIsAiSpeaking(false);
    }
    setIsPressing(true);
    hasSpokenActiveRef.current = true;
    lastSpeechTimeRef.current = Date.now();
  };

  const handlePressEnd = () => {
    if (!isPressingRef.current) return;
    setIsPressing(false);
    if (hasSpokenActiveRef.current) {
      hasSpokenActiveRef.current = false;
      if (sessionRef.current && sessionRef.current.readyState === WebSocket.OPEN) {
        sessionRef.current.send(JSON.stringify({ clientContent: { turnComplete: true } }));
      }
    }
  };

  const buttonBinders = {
    onMouseDown: handlePressStart,
    onMouseUp: handlePressEnd,
    onMouseLeave: handlePressEnd,
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); handlePressStart(); },
    onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); handlePressEnd(); },
    onTouchCancel: (e: React.TouchEvent) => { e.preventDefault(); handlePressEnd(); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-between p-6 text-white animate-in fade-in duration-300">

      {/* Top Header */}
      <div className="w-full flex justify-between items-center shrink-0">
        <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => handleModeSwitch(TutorMode.CONVERSATION)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${currentMode === TutorMode.CONVERSATION ? 'bg-pink-600 text-white shadow-lg' : 'text-white/40'}`}
          >Chat</button>
          <button
            onClick={() => handleModeSwitch(TutorMode.IELTS)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${currentMode === TutorMode.IELTS ? 'bg-rose-600 text-white shadow-lg' : 'text-white/40'}`}
          >IELTS</button>
          <button
            onClick={() => handleModeSwitch(TutorMode.TUTOR_30_DAYS)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${currentMode === TutorMode.TUTOR_30_DAYS ? 'bg-orange-600 text-white shadow-lg' : 'text-white/40'}`}
          >30D</button>
        </div>
        {/* Nút X — gọi handleClose để tắt mic */}
        <button onClick={handleClose} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full max-w-lg py-4">

        {/* Animation */}
        <div className="relative flex flex-col items-center justify-center">
          <div className={`w-28 h-28 rounded-[2rem] bg-gradient-to-br from-pink-600 to-rose-600 flex items-center justify-center shadow-2xl transition-all duration-500 ${isAiSpeaking ? 'scale-110 shadow-pink-500/50' : 'scale-100'}`}>
            <div className="flex items-end gap-1 h-10">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="w-1.5 bg-white rounded-full transition-all duration-200" style={{ height: isAiSpeaking ? `${20 + Math.random() * 80}%` : '6px' }} />
              ))}
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="text-center space-y-1">
          <h2 className="text-xl font-black tracking-tight">
            {status === 'connecting' ? 'ĐANG KẾT NỐI...' :
             status === 'error' ? 'LỖI KẾT NỐI' :
             isAiSpeaking ? 'AURA ĐANG NÓI' :
             isPressing ? 'ĐANG NGHE BẠN...' : 'SẴN SÀNG'}
          </h2>
          <p className="text-pink-400 text-[10px] font-black uppercase tracking-[0.25em]">
            {status === 'error' ? 'Vui lòng thử lại' : 'Mic đang hoạt động · Tắt khi bạn thoát'}
          </p>
        </div>

        {/* Hold to Talk / Auto toggle */}
        <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 text-xs shrink-0 select-none">
          <button
            onClick={() => setIsHoldToTalk(true)}
            className={`px-3 py-1.5 rounded-lg font-black transition-all cursor-pointer flex items-center gap-1.5 ${isHoldToTalk ? 'bg-pink-600 text-white shadow-lg' : 'text-white/40 hover:text-white/70'}`}
          >
            <span>🖐</span> Nhấn giữ để nói
          </button>
          <button
            onClick={() => setIsHoldToTalk(false)}
            className={`px-3 py-1.5 rounded-lg font-black transition-all cursor-pointer flex items-center gap-1.5 ${!isHoldToTalk ? 'bg-purple-600 text-white shadow-lg' : 'text-white/40 hover:text-white/70'}`}
          >
            <span>🎙</span> Tự động (Im lặng 2s)
          </button>
        </div>

        {/* Button hoặc Waveform */}
        <div className="h-28 w-full flex items-center justify-center transition-all">
          {isHoldToTalk ? (
            <div className="flex flex-col items-center gap-2">
              <button
                {...buttonBinders}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                  isPressing
                    ? 'bg-rose-600 text-white scale-110 shadow-[0_0_30px_rgba(244,63,94,0.6)]'
                    : 'bg-white/10 hover:bg-white/15 text-white border border-white/20 cursor-pointer shadow-lg'
                }`}
                style={{ touchAction: 'none' }}
              >
                {isPressing && <div className="absolute inset-0 rounded-full border-2 border-rose-500 animate-ping opacity-75" />}
                {isPressing ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="animate-pulse"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                )}
              </button>
              <span className="text-[10px] font-bold text-slate-400 select-none">
                {isPressing ? 'Đang ghi âm... Thả ra để gửi' : 'Chạm và giữ để nói'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 w-full">
              <div className="flex items-center gap-1 justify-center h-10 w-full max-w-xs">
                {Array.from({ length: 9 }).map((_, i) => {
                  const heightVal = Math.min(48, Math.max(6, userRms * (1.2 - Math.abs(i - 4) * 0.18)));
                  return (
                    <div key={i} className="w-1.5 rounded-full bg-gradient-to-t from-pink-500 to-rose-500 transition-all duration-75" style={{ height: `${heightVal}px` }} />
                  );
                })}
              </div>
              <span className="text-[10px] font-bold text-slate-400 text-center select-none">
                {userRms > 6 ? (
                  <span className="text-green-400 animate-pulse font-extrabold uppercase tracking-wide">✓ Đang nghe (Vol: {userRms})</span>
                ) : (
                  <span>Nói tự do. Im lặng 2 giây hệ thống sẽ trả lời.</span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Transcription */}
        <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 min-h-[120px] flex flex-col gap-3 shadow-inner">
          <div>
            <span className="text-[9px] font-black text-pink-500 uppercase tracking-widest block mb-0.5">Bạn nói</span>
            <p className="text-xs text-slate-300 italic leading-relaxed">{userTranscription || "Đang chờ giọng nói..."}</p>
          </div>
          <div className="pt-3 border-t border-white/5">
            <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest block mb-0.5">Aura trả lời</span>
            <p className="text-xs text-white font-medium leading-relaxed">{modelTranscription || "..."}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full max-w-sm pb-4 flex flex-col gap-3 shrink-0">
        <div className="flex justify-center items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-green-500 animate-pulse' : status === 'error' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`}></div>
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
            {status === 'active' ? (isHoldToTalk ? 'CHẾ ĐỘ NHẤN GIỮ' : 'CHẾ ĐỘ TỰ ĐỘNG') : status === 'error' ? 'MẤT KẾT NỐI' : 'ĐANG KẾT NỐI'}
          </span>
        </div>
        {/* Nút Finish — cũng gọi handleClose */}
        <button onClick={handleClose} className="w-full bg-white text-slate-950 font-black py-4 rounded-xl shadow-xl active:scale-95 transition-all uppercase tracking-widest text-xs cursor-pointer">
          Kết thúc phiên nói chuyện
        </button>
      </div>
    </div>
  );
};

export default VoiceInterface;
