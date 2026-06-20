
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

// Audio Utilities
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

const VoiceInterface: React.FC<VoiceInterfaceProps> = ({ mode: initialMode, onClose, onModeChange, currentDay = 1, dayGoal = "Self-introduction" }) => {
  const [currentMode, setCurrentMode] = useState<TutorMode>(initialMode);
  const [status, setStatus] = useState<'connecting' | 'active' | 'error'>('connecting');
  const [userTranscription, setUserTranscription] = useState('');
  const [modelTranscription, setModelTranscription] = useState('');
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  // Advanced States
  const [isHoldToTalk, setIsHoldToTalk] = useState(true);
  const [isPressing, setIsPressing] = useState(false);
  const [userRms, setUserRms] = useState(0); // For live visualization level

  const sessionRef = useRef<any>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Refs to avoid stale closure issues in onaudioprocess
  const isHoldToTalkRef = useRef(true);
  const isPressingRef = useRef(false);
  const lastSpeechTimeRef = useRef(0);
  const hasSpokenActiveRef = useRef(false);

  useEffect(() => {
    isHoldToTalkRef.current = isHoldToTalk;
  }, [isHoldToTalk]);

  useEffect(() => {
    isPressingRef.current = isPressing;
  }, [isPressing]);

  const cleanup = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    inputAudioCtxRef.current?.close();
    outputAudioCtxRef.current?.close();
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const startSession = useCallback(async (mode: TutorMode) => {
    cleanup();
    setStatus('connecting');

    try {
      // Setup microphone stream with hardware filtering if supported
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });

      inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      // Hardware amplification node (boost sensitivity)
      const gainNode = inputAudioCtxRef.current.createGain();
      gainNode.gain.value = 2.5; // Up from 1.8 to 2.5 for highly sensitive voice capture

      // Biquad filters inside the web audio pipeline to perform software noise reduction
      // 1. Low cut high-pass filter: Eliminate household AC/room hum emissions (frequencies below 80Hz)
      const lowCutFilter = inputAudioCtxRef.current.createBiquadFilter();
      lowCutFilter.type = 'highpass';
      lowCutFilter.frequency.value = 80;

      // 2. High cut low-pass filter: Cut off whistling, clicks and high frequency noise (frequencies above 4000Hz)
      const highCutFilter = inputAudioCtxRef.current.createBiquadFilter();
      highCutFilter.type = 'lowpass';
      highCutFilter.frequency.value = 4000;

      // AnalyserNode to feed volume detection
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
        
        // Connect cascading audio pipeline: Source -> Hum Filter -> Whistle Filter -> Gain Boost -> Analyser -> Output Processor
        source.connect(lowCutFilter);
        lowCutFilter.connect(highCutFilter);
        highCutFilter.connect(gainNode);
        gainNode.connect(analyserNode);
        analyserNode.connect(processor);
        processor.connect(inputAudioCtxRef.current!.destination);

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);

          // Calculate current sound level (RMS Amplitude)
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          
          // Scale the RMS output for smooth UI bar animations
          setUserRms(Math.min(100, Math.floor(rms * 1200)));

          // If Touch-to-talk mode is active and user is NOT pushing/holding, we skip transmitting audio packets.
          if (isHoldToTalkRef.current && !isPressingRef.current) {
            return;
          }

          // Speech activity analysis:
          // Volume threshold of 0.004 indicates speech (extremely sensitive, filters noise due to biquad filters)
          if (rms > 0.004) {
            if (!hasSpokenActiveRef.current) {
              hasSpokenActiveRef.current = true;
            }
            lastSpeechTimeRef.current = Date.now();
          } else {
            // If in Hands-free mode and we previously detected active speech, trigger response after 2 seconds silence.
            if (!isHoldToTalkRef.current && hasSpokenActiveRef.current) {
              const silentMs = Date.now() - lastSpeechTimeRef.current;
              if (silentMs > 2000) {
                hasSpokenActiveRef.current = false; // Reset speech flag to avoid double trigger
                if (ws && ws.readyState === WebSocket.OPEN) {
                  try {
                    // Signal turn end so model starts generation immediately
                    ws.send(JSON.stringify({ clientContent: { turnComplete: true } }));
                  } catch (err) {
                    console.warn("Auto-responding turnComplete trigger failed:", err);
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
              // Reset speech trigger state for the new turn
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
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsAiSpeaking(false);
            }
          } else if (parsed.type === "error") {
            console.error("Gemini live WebSocket error response:", parsed.error);
            setStatus('error');
          }
        } catch (err) {
          console.error("Error handling ws message from server proxy:", err);
        }
      };

      ws.onerror = (e) => { 
        console.error("WebSocket client connection error:", e); 
        setStatus('error'); 
      };

      ws.onclose = () => {
        // If still active, try to gracefully flag transitioning or connecting status
        console.log("WebSocket client connection closed.");
      };

    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  }, [cleanup, currentDay, dayGoal]);

  useEffect(() => {
    startSession(currentMode);
    return cleanup;
  }, [currentMode, startSession, cleanup]);

  const handleModeSwitch = (newMode: TutorMode) => {
    if (newMode !== currentMode) {
      setCurrentMode(newMode);
      onModeChange(newMode);
    }
  };

  // Push-to-Talk action triggers
  const handlePressStart = () => {
    if (isAiSpeaking) {
      // Interrupt model audio if active
      if (sessionRef.current) {
        sourcesRef.current.forEach(s => s.stop());
        sourcesRef.current.clear();
        nextStartTimeRef.current = 0;
        setIsAiSpeaking(false);
      }
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

  // Combine touch and mouse events for unified touch-to-talk buttons
  const buttonBinders = {
    onMouseDown: handlePressStart,
    onMouseUp: handlePressEnd,
    onMouseLeave: handlePressEnd,
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault();
      handlePressStart();
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.preventDefault();
      handlePressEnd();
    },
    onTouchCancel: (e: React.TouchEvent) => {
      e.preventDefault();
      handlePressEnd();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-between p-6 text-white animate-in fade-in duration-300">
      
      {/* Top Header Controls */}
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
        <button onClick={onClose} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      {/* Main Core View Area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full max-w-lg py-4">
        
        {/* Interactive Speech Animation & Audio visualizer */}
        <div className="relative flex flex-col items-center justify-center">
          <div className={`w-28 h-28 rounded-[2rem] bg-gradient-to-br from-pink-600 to-rose-600 flex items-center justify-center shadow-2xl transition-all duration-500 ${isAiSpeaking ? 'scale-110 shadow-pink-500/50' : 'scale-100'}`}>
            <div className="flex items-end gap-1 h-10">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="w-1.5 bg-white rounded-full transition-all duration-200" style={{ height: isAiSpeaking ? `${20 + Math.random() * 80}%` : '6px' }} />
              ))}
            </div>
          </div>
        </div>

        {/* State Labelings */}
        <div className="text-center space-y-1">
          <h2 className="text-xl font-black tracking-tight">
            {status === 'connecting' ? 'SYNCING...' : isAiSpeaking ? 'AURA IS SPEAKING' : isPressing ? 'LISTENING TO YOU...' : 'READY FOR TALK'}
          </h2>
          <p className="text-pink-400 text-[10px] font-black uppercase tracking-[0.25em]">Dual Sensitivity & Hardware Hum-Filter Active</p>
        </div>

        {/* Voice Mode Toggle Selector */}
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

        {/* Touch Button OR Audio Level Visualizer */}
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
                {isPressing && (
                  <div className="absolute inset-0 rounded-full border-2 border-rose-500 animate-ping opacity-75" />
                )}
                {isPressing ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="animate-pulse"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                )}
              </button>
              <span className="text-[10px] font-bold text-slate-400 select-none">
                {isPressing ? 'Đang truyền âm... Thả ra để hoàn tất' : 'Chạm và Giữ nút này để phát biểu'}
              </span>
            </div>
          ) : (
            /* Interactive voice waveform with live sound intensity feedback */
            <div className="flex flex-col items-center gap-3 w-full">
              <div className="flex items-center gap-1 justify-center h-10 w-full max-w-xs relative flex-nowrap">
                {Array.from({ length: 9 }).map((_, i) => {
                  const heightVal = Math.min(48, Math.max(6, userRms * (1.2 - Math.abs(i - 4) * 0.18)));
                  return (
                    <div 
                      key={i} 
                      className="w-1.5 rounded-full bg-gradient-to-t from-pink-500 to-rose-500 transition-all duration-75"
                      style={{ height: `${heightVal}px` }} 
                    />
                  );
                })}
              </div>
              <span className="text-[10px] font-bold text-slate-400 text-center select-none">
                {userRms > 6 ? (
                  <span className="text-green-400 animate-pulse font-extrabold uppercase tracking-wide">✓ Phát hiện tiếng nói (Vol: {userRms})</span>
                ) : (
                  <span>Nói tự do. Im lặng 2 giây hệ thống sẽ tự trả lời.</span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Real-time speech transcription dashboard */}
        <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 min-h-[120px] flex flex-col gap-3 shadow-inner">
           <div>
              <span className="text-[9px] font-black text-pink-500 uppercase tracking-widest block mb-0.5">Your Speech</span>
              <p className="text-xs text-slate-300 italic leading-relaxed">{userTranscription || "Waiting for voice input..."}</p>
           </div>
           <div className="pt-3 border-t border-white/5">
              <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest block mb-0.5">Aura's Feed</span>
              <p className="text-xs text-white font-medium leading-relaxed">{modelTranscription || "..."}</p>
           </div>
        </div>
      </div>

      {/* Actions and Status logs */}
      <div className="w-full max-w-sm pb-4 flex flex-col gap-3 shrink-0">
        <div className="flex justify-center items-center gap-2">
           <div className={`w-2 h-2 rounded-full bg-green-500 animate-pulse`}></div>
           <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
             {isHoldToTalk ? 'MỘT CHẠM PHÁT NGÔN' : 'TỰ ĐỘNG LỌC ÂM NỀN'}
           </span>
        </div>
        <button onClick={onClose} className="w-full bg-white text-slate-950 font-black py-4 rounded-xl shadow-xl active:scale-95 transition-all uppercase tracking-widest text-xs cursor-pointer">
          Finish Voice Session
        </button>
      </div>
    </div>
  );
};

export default VoiceInterface;
