import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { DanmakuItem, StreamSegment } from '../types';
import DanmakuContent from './DanmakuContent';
import { Settings, X, Plus, Trash2 } from 'lucide-react';

interface FilterSettings {
    medalFilterEnabled: boolean;
    minMedalLevel: number;
    blockedKeywords: string[];
}

interface ChatListProps {
    danmakuData: DanmakuItem[];
    currentTime: number;
    currentSegment: StreamSegment;
    isFullscreen: boolean;
    filterSettings: FilterSettings;
    setFilterSettings: React.Dispatch<React.SetStateAction<FilterSettings>>;
}


const ChatList: React.FC<ChatListProps> = ({ danmakuData, currentTime, currentSegment, isFullscreen, filterSettings, setFilterSettings }) => {
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [showFilterSettings, setShowFilterSettings] = useState(false);
    const [newKeyword, setNewKeyword] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);

    const handleSync = () => {
        setIsSyncing(true);
        // Save is already handled by parent useEffect, but we provide visual feedback
        setTimeout(() => setIsSyncing(false), 800);
    };

    // Filter visible chat: Show only recent items and apply blocking rules
    const visibleChatList = useMemo(() => {
        const filtered = danmakuData.filter(d => {
            // Basic time filter
            if (d.time > currentTime) return false;

            // Medal filter
            if (filterSettings.medalFilterEnabled) {
                const level = d.medalLevel || 0;
                if (level < filterSettings.minMedalLevel) return false;
            }

            // Keyword filter
            if (filterSettings.blockedKeywords.length > 0) {
                const content = d.content.toLowerCase();
                if (filterSettings.blockedKeywords.some(k => content.includes(k.toLowerCase()))) {
                    return false;
                }
            }

            return true;
        });

        // If there are too many items, only show the last 200 to keep rendering smooth
        if (filtered.length > 200) {
            return filtered.slice(-200);
        }
        return filtered;
    }, [danmakuData, currentTime, filterSettings]);

    // Sync Danmaku List Scroll
    useEffect(() => {
        if (autoScroll && chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [visibleChatList.length, autoScroll]);

    const handleChatScroll = useCallback(() => {
        if (!chatContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        const isBottom = scrollHeight - scrollTop - clientHeight < 50; // Threshold
        if (isBottom) {
            if (!autoScroll) setAutoScroll(true);
        } else {
            if (autoScroll) setAutoScroll(false);
        }
    }, [autoScroll]);

    const scrollToBottom = () => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
            setAutoScroll(true);
        }
    };

    if (isFullscreen) return null;

    return (
        <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col shrink-0 font-sans transition-colors duration-300">
            <div className="h-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 justify-between shrink-0 relative">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">弹幕列表 ({visibleChatList.length})</span>
                <button
                    onClick={() => setShowFilterSettings(!showFilterSettings)}
                    className={`p-1.5 rounded-md transition-colors ${showFilterSettings ? 'bg-[#FB7299] text-white' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                    title="屏蔽设置"
                >
                    <Settings className="w-4 h-4" />
                </button>

                {/* Filter Settings Panel */}
                {showFilterSettings && (
                    <div className="absolute top-11 right-2 w-72 bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 rounded-lg z-50 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-gray-800 dark:text-white">弹幕过滤设置</h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleSync}
                                    className={`text-xs px-2 py-1 rounded transition-all ${isSyncing ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
                                >
                                    {isSyncing ? '同步成功' : '同步'}
                                </button>
                                <button onClick={() => setShowFilterSettings(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {/* Medal Filter */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">开启等级屏蔽</label>
                                    <input
                                        type="checkbox"
                                        checked={filterSettings.medalFilterEnabled}
                                        onChange={(e) => setFilterSettings({ ...filterSettings, medalFilterEnabled: e.target.checked })}
                                        className="w-4 h-4 accent-[#FB7299]"
                                    />
                                </div>
                                {filterSettings.medalFilterEnabled && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500">最低等级:</span>
                                        <input
                                            type="number"
                                            min="1"
                                            max="50"
                                            value={filterSettings.minMedalLevel}
                                            onChange={(e) => setFilterSettings({ ...filterSettings, minMedalLevel: parseInt(e.target.value) || 0 })}
                                            className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-transparent px-2 py-1 dark:text-white focus:outline-none focus:border-[#FB7299]"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="h-px bg-gray-100 dark:bg-gray-700" />

                            {/* Keywords Filter */}
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">屏蔽关键词</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="输入关键词..."
                                        value={newKeyword}
                                        onChange={(e) => setNewKeyword(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newKeyword.trim()) {
                                                if (!filterSettings.blockedKeywords.includes(newKeyword.trim())) {
                                                    setFilterSettings({
                                                        ...filterSettings,
                                                        blockedKeywords: [...filterSettings.blockedKeywords, newKeyword.trim()]
                                                    });
                                                }
                                                setNewKeyword('');
                                            }
                                        }}
                                        className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-transparent px-2 py-1 dark:text-white focus:outline-none focus:border-[#FB7299]"
                                    />
                                    <button
                                        onClick={() => {
                                            if (newKeyword.trim()) {
                                                if (!filterSettings.blockedKeywords.includes(newKeyword.trim())) {
                                                    setFilterSettings({
                                                        ...filterSettings,
                                                        blockedKeywords: [...filterSettings.blockedKeywords, newKeyword.trim()]
                                                    });
                                                }
                                                setNewKeyword('');
                                            }
                                        }}
                                        className="p-1 bg-[#FB7299] text-white rounded hover:bg-[#E46187]"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1 mt-2">
                                    {filterSettings.blockedKeywords.map((k, i) => (
                                        <div key={i} className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-[10px] px-2 py-1 rounded text-gray-600 dark:text-gray-300">
                                            <span>{k}</span>
                                            <button
                                                onClick={() => setFilterSettings({
                                                    ...filterSettings,
                                                    blockedKeywords: filterSettings.blockedKeywords.filter(item => item !== k)
                                                })}
                                                className="text-gray-400 hover:text-red-500"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                    {filterSettings.blockedKeywords.length === 0 && (
                                        <span className="text-[10px] text-gray-400">暂无屏蔽词</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div
                className="flex-1 overflow-y-auto scrollbar-thin relative p-2 bg-[#f8f8f8] dark:bg-[#181818]"
                ref={chatContainerRef}
                onScroll={handleChatScroll}
            >
                {visibleChatList.map((d, idx) => {
                    // Check for sticker content for chat list
                    if (d.stickerUrl) {
                        return (
                            <div key={idx} className="mb-1.5 text-xs px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">
                                <div className="flex items-start flex-wrap align-middle">
                                    <span className="text-[#999] dark:text-gray-400 font-medium mr-2">{d.senderName}:</span>
                                    <img src={d.stickerUrl} alt="Sticker" className="h-8 w-auto" referrerPolicy="no-referrer" />
                                </div>
                            </div>
                        );
                    }

                    const medalColor = d.medalColorBorder || '#61c05a'; // Fallback green if not present

                    return (
                        <div
                            key={idx}
                            className={`mb-1.5 text-xs px-2 py-1 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-700`}
                        >
                            <div className="flex items-start flex-wrap align-middle leading-5">
                                {/* Medal/Badge */}
                                {d.medalName && (
                                    <div
                                        className="inline-flex items-center border rounded-[2px] mr-1.5 h-4 overflow-hidden select-none align-text-bottom translate-y-[1px]"
                                        style={{ borderColor: medalColor }}
                                    >
                                        <span
                                            className="px-1 text-[10px] font-medium leading-[14px] bg-white dark:bg-gray-800"
                                            style={{ color: medalColor }}
                                        >
                                            {d.medalName}
                                        </span>
                                        <span
                                            className="px-0.5 text-[10px] text-white font-medium leading-[14px] min-w-[14px] text-center"
                                            style={{ backgroundColor: medalColor }}
                                        >
                                            {d.medalLevel || 1}
                                        </span>
                                    </div>
                                )}

                                {/* Username */}
                                <span className="text-[#999] dark:text-gray-400 font-medium mr-2 cursor-pointer hover:text-[#23ade5]">
                                    {d.senderName || '用户'}:
                                </span>

                                {/* Content */}
                                <span className="text-[#333] dark:text-gray-200 break-all">
                                    <DanmakuContent content={d.content} emots={d.emots} />
                                </span>
                            </div>
                        </div>
                    );
                })}
                {danmakuData.length === 0 && (
                    <div className="text-center text-gray-400 mt-10 text-sm">
                        {currentSegment.danmakuFile ? '正在加载弹幕...' : '无弹幕文件'}
                    </div>
                )}

                {/* Scroll to Bottom Button */}
                {!autoScroll && (
                    <div className="sticky bottom-0 left-0 right-0 flex justify-center pb-2 pt-4 bg-gradient-to-t from-[#f8f8f8] dark:from-[#181818] to-transparent pointer-events-none">
                        <button
                            onClick={scrollToBottom}
                            className="bg-[#FB7299] hover:bg-[#E46187] text-white text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1 transition-all pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200"
                        >
                            <span>↓</span>
                            <span>最新弹幕</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(ChatList);

