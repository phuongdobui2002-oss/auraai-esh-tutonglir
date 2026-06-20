
import React from 'react';
import { Message } from '../types';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  
  const formatContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      // Bold handling
      let formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-pink-900">$1</strong>');
      if (isUser) {
        formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
      }
      
      // List handling
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        return (
          <li key={i} className="ml-4 list-disc mb-1" dangerouslySetInnerHTML={{ __html: formattedLine.substring(2) }} />
        );
      }
      
      return (
        <p key={i} className="mb-2 last:mb-0" dangerouslySetInnerHTML={{ __html: formattedLine }} />
      );
    });
  };

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-3 duration-500 ease-out`}>
      <div className={`max-w-[90%] md:max-w-[75%] lg:max-w-[70%] rounded-[1.5rem] px-5 py-4 shadow-sm border ${
        isUser 
          ? 'bg-gradient-to-br from-pink-600 to-rose-600 text-white rounded-tr-none border-pink-500 shadow-pink-100' 
          : 'bg-white/95 backdrop-blur-sm text-slate-800 border-white rounded-tl-none shadow-pink-100/50'
      }`}>
        <div className={`text-[11px] font-black mb-1 uppercase tracking-widest ${isUser ? 'text-pink-100' : 'text-pink-600'}`}>
          {isUser ? 'YOU' : 'AuraAI'}
        </div>
        <div className="text-[15px] leading-relaxed font-medium">
          {formatContent(message.content)}
        </div>
        <div className={`text-[10px] mt-2 font-bold opacity-40 ${isUser ? 'text-right' : 'text-left'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
