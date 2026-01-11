import React, { useState, useMemo } from 'react';
import { ArrowLeft, Search, Clock, MessageSquare, ExternalLink } from 'lucide-react';
import { StreamerProfile, StreamSession } from '../types';
import { formatDateFriendly, formatDuration } from '../utils/parser';

interface StreamerPageProps {
  streamer: StreamerProfile;
  onBack: () => void;
  onSelectSession: (session: StreamSession) => void;
}

const StreamerPage: React.FC<StreamerPageProps> = ({ streamer, onBack, onSelectSession }) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Group sessions by friendly date
  const groupedSessions = useMemo(() => {
    const groups: Record<string, StreamSession[]> = {};
    
    streamer.sessions.forEach(session => {
        // Filter by search
        if (searchTerm && !session.title.toLowerCase().includes(searchTerm.toLowerCase())) {
            return;
        }

        const dateKey = formatDateFriendly(session.startTime);
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(session);
    });
    
    return groups;
  }, [streamer.sessions, searchTerm]);

  return (
    <div className="min-h-screen bg-[#f1f2f3] dark:bg-[#0f0f0f] transition-colors duration-300">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 shadow-sm px-6 py-3 flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-600 dark:text-gray-300"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
             <h1 className="font-bold text-xl flex items-center gap-2 text-gray-900 dark:text-white">
                {streamer.name}
                <a 
                   href={`https://live.bilibili.com/${streamer.roomId}`} 
                   target="_blank" 
                   rel="noreferrer"
                   className="text-xs font-normal text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded hover:text-[#23ade5]"
                >
                   {streamer.roomId}
                </a>
             </h1>
          </div>
        </div>
        
        <div className="relative">
           <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
           <input 
              type="text" 
              placeholder="搜索直播标题..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[#FB7299]/20 w-64 transition-all text-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
           />
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {(Object.entries(groupedSessions) as [string, StreamSession[]][]).map(([dateLabel, sessions]) => (
            <div key={dateLabel} className="mb-10">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center before:content-[''] before:w-1.5 before:h-6 before:bg-[#FB7299] before:mr-3 before:rounded-full">
                    {dateLabel}
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {sessions.map(session => (
                        <div 
                            key={session.id}
                            onClick={() => onSelectSession(session)}
                            className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm hover:shadow-lg transition-all group cursor-pointer border border-transparent hover:border-[#FB7299]/30"
                        >
                            <div className="aspect-video bg-gray-900 relative">
                                {session.segments[0]?.coverFile && (
                                    <img 
                                        src={URL.createObjectURL(session.segments[0].coverFile)} 
                                        className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                        alt={session.title}
                                    />
                                )}
                                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent flex justify-between items-end text-white text-xs">
                                   <div className="flex items-center gap-1">
                                       <MessageSquare className="w-3 h-3" />
                                       <span>{session.totalDanmakuCount > 0 ? session.totalDanmakuCount.toLocaleString() : '无弹幕'}</span>
                                   </div>
                                   <div className="flex items-center gap-1">
                                       <Clock className="w-3 h-3" />
                                       <span>{formatDuration(session.totalDuration)}</span>
                                   </div>
                                </div>
                            </div>
                            <div className="p-3">
                                <h3 className="font-medium text-gray-800 dark:text-gray-100 line-clamp-2 h-10 text-sm leading-relaxed group-hover:text-[#FB7299] transition-colors">
                                    {session.title}
                                </h3>
                                <div className="mt-2 flex gap-2">
                                   {session.segments.length > 1 && (
                                       <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded border border-gray-200 dark:border-gray-600">
                                           {session.segments.length} P
                                       </span>
                                   )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        ))}

        {Object.keys(groupedSessions).length === 0 && (
            <div className="text-center py-20 text-gray-400">
                没有找到相关的直播记录
            </div>
        )}
      </div>
    </div>
  );
};

export default StreamerPage;