import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ArrowLeft, Play, Pause, Volume2, VolumeX, Settings, Maximize, Minimize } from 'lucide-react';
import { StreamSession, DanmakuItem, StreamSegment } from '../types';
import { parseDanmakuXml, formatSegmentTime } from '../utils/parser';
import mpegts from 'mpegts.js';

interface PlayerProps {
    session: StreamSession;
    onBack: () => void;
}

// Helper to render text mixed with images (inline stickers)
const DanmakuContent: React.FC<{ content: string; emots?: Record<string, string>; color?: number }> = React.memo(({ content, emots, color }) => {
    if (!emots || Object.keys(emots).length === 0) {
        return <>{content}</>;
    }

    // Split content by emoticon keys (e.g. [dog])
    const keys = Object.keys(emots).sort((a, b) => b.length - a.length);
    // Escape regex characters
    const pattern = new RegExp(`(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');

    const parts = content.split(pattern);
    return (
        <>
            {parts.map((part, i) => {
                if (emots[part]) {
                    return (
                        <img
                            key={i}
                            src={emots[part]}
                            alt={part}
                            className="inline-block h-[1.3em] w-auto align-text-bottom mx-0.5"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                        />
                    );
                }
                return <span key={i}>{part}</span>;
            })}
        </>
    );
});

const STORAGE_KEY_SETTINGS = 'bili-player-settings';
const STORAGE_KEY_HISTORY = 'bili-player-history';

const Player: React.FC<PlayerProps> = ({ session, onBack }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const mpegtsPlayerRef = useRef<any>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const wasLongPressRef = useRef(false);

    // Player State
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0); // Driven by timeupdate (low freq)
    const [smoothTime, setSmoothTime] = useState(0); // Driven by RAF (high freq)
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isLongPressing, setIsLongPressing] = useState(false); // Long press for speed
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Danmaku State
    // Defaults normalized to 1.0
    const [danmakuData, setDanmakuData] = useState<DanmakuItem[]>([]);

    // Load settings from storage
    const [danmakuSettings, setDanmakuSettings] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
        if (saved) {
            try {
                return {
                    ...{ show: true, opacity: 1, size: 1.0, speed: 1.0, playbackRate: 1.0, longPressRate: 2.0 },
                    ...JSON.parse(saved)
                };
            } catch (e) { }
        }
        return {
            show: true,
            opacity: 1,
            size: 1.0,
            speed: 1.0,
            playbackRate: 1.0,
            longPressRate: 2.0,
        };
    });

    const [showSettings, setShowSettings] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);

    const currentSegment = session.segments[currentSegmentIndex];

    // Save settings (excluding playbackRate)
    useEffect(() => {
        const { playbackRate, ...toSave } = danmakuSettings;
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(toSave));
    }, [danmakuSettings]);

    // History: Load on mount (session change)
    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
            if (raw) {
                const history = JSON.parse(raw);
                const record = history[session.id];
                // Only resume if within reasonable bounds (e.g. > 5s and not finished)
                if (record && record.time > 5 && record.segmentIndex !== undefined) {
                    if (record.segmentIndex >= 0 && record.segmentIndex < session.segments.length) {
                        setCurrentSegmentIndex(record.segmentIndex);
                        // The actual seek needs to happen after video loads, we'll store a ref or flag
                        // But since we switch segment, the player re-inits. 
                        // We can pass the start time to the setup logic or use a ref.
                        // Ideally, we wait for 'loadedmetadata' or just set it in setup.
                        // Simple approach: Set a target time ref.
                        initialSeekTimeRef.current = record.time;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to load history", e);
        }
    }, [session.id]); // Only runs when session ID changes (initially)

    const initialSeekTimeRef = useRef<number | null>(null);

    const saveHistory = useCallback((time: number, segmentIdx: number) => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
            let history = raw ? JSON.parse(raw) : {};

            history[session.id] = {
                time,
                segmentIndex: segmentIdx,
                ts: Date.now()
            };

            // Cleanup: keep only latest 100 sessions to prevent storage bloating
            const keys = Object.keys(history);
            if (keys.length > 100) {
                const sortedKeys = keys.sort((a, b) => history[b].ts - history[a].ts);
                const keysToRemove = sortedKeys.slice(100);
                keysToRemove.forEach(k => delete history[k]);
            }

            localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
        } catch (e) { }
    }, [session.id]);

    // Load XML
    useEffect(() => {
        const loadDanmaku = async () => {
            if (currentSegment.danmakuFile) {
                try {
                    const items = await parseDanmakuXml(currentSegment.danmakuFile);
                    setDanmakuData(items);
                } catch (e) {
                    console.error("Failed to parse XML", e);
                    setDanmakuData([]);
                }
            } else {
                setDanmakuData([]);
            }
        };
        loadDanmaku();
    }, [currentSegment]);

    // Apply Playback Speed
    useEffect(() => {
        if (videoRef.current) {
            const rate = isLongPressing ? danmakuSettings.longPressRate : danmakuSettings.playbackRate;
            videoRef.current.playbackRate = rate;
        }
    }, [danmakuSettings.playbackRate, danmakuSettings.longPressRate, isLongPressing]);

    // Request Animation Frame loop for smooth danmaku
    const updateSmoothTime = useCallback(() => {
        if (videoRef.current && !videoRef.current.paused) {
            setSmoothTime(videoRef.current.currentTime);
            animationFrameRef.current = requestAnimationFrame(updateSmoothTime);
        }
    }, []);

    useEffect(() => {
        if (isPlaying) {
            animationFrameRef.current = requestAnimationFrame(updateSmoothTime);
        } else {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        }
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [isPlaying, updateSmoothTime]);

    // Initialize Player
    useEffect(() => {
        let isMounted = true;
        setErrorMsg(null);
        setIsPlaying(false);

        // Don't reset time if we are just switching quality, but here we switch segments which are different files.
        // If initialSeekTimeRef is set, use it, otherwise 0.
        // NOTE: If we switched segments manually, we probably want 0. 
        // But if we loaded from history, we want the specific time.
        // We only check initialSeekTimeRef if it matches current segment? 
        // Actually, the segment index sets the currentSegment. 
        // So if we just mounted or changed segment, check if we need to seek.

        const startTime = initialSeekTimeRef.current !== null ? initialSeekTimeRef.current : 0;
        // Consume the ref immediately if we are going to use it, but wait, 
        // if we change segment manually, we don't want to seek to the old history time.
        // History logic set segment index AND time.
        // Standard behavior: Reset to 0 on explicit segment change unless it's the *initial* load resume.
        // For simplicity: If initialSeekTimeRef is present, use it and clear it.

        setCurrentTime(startTime);
        setSmoothTime(startTime);

        if (!videoRef.current || !currentSegment.file) return;

        const videoEl = videoRef.current;
        const fileUrl = URL.createObjectURL(currentSegment.file.originalFile);
        const type = currentSegment.file.ext;
        let player: any = null;

        // Apply volume settings
        videoEl.volume = isMuted ? 0 : volume;

        const setupPlayer = async () => {
            videoEl.removeAttribute('src');
            videoEl.load();

            const onPlayerReady = () => {
                if (initialSeekTimeRef.current !== null) {
                    videoEl.currentTime = initialSeekTimeRef.current;
                    initialSeekTimeRef.current = null;
                }
            };

            if (type === 'flv') {
                if (mpegts && mpegts.isSupported()) {
                    try {
                        player = mpegts.createPlayer({
                            type: 'flv',
                            url: fileUrl,
                            isLive: false,
                        }, {
                            enableWorker: true,
                            lazyLoad: false,
                        });
                        player.attachMediaElement(videoEl);
                        player.load();

                        if (isMounted) {
                            mpegtsPlayerRef.current = player;
                            // Wait for metadata to seek?
                            player.on(mpegts.Events.METADATA_ARRIVED, onPlayerReady);

                            const playPromise = player.play();
                            if (playPromise !== undefined) {
                                playPromise.catch((e: any) => { });
                            }
                            setIsPlaying(true);
                        } else {
                            player.destroy();
                        }
                    } catch (err: any) {
                        console.error("Mpegts error:", err);
                        if (isMounted) setErrorMsg(`播放器初始化失败: ${err.message}`);
                    }
                } else {
                    if (isMounted) setErrorMsg("浏览器不支持 FLV 播放，且未检测到 mpegts.js 组件");
                }
            } else {
                videoEl.src = fileUrl;
                videoEl.load();
                videoEl.addEventListener('loadedmetadata', onPlayerReady, { once: true });

                const playPromise = videoEl.play();
                if (playPromise !== undefined) {
                    playPromise.catch((e) => { });
                }
                if (isMounted) setIsPlaying(true);
            }
        };

        setupPlayer();

        const handleTimeUpdate = () => {
            setCurrentTime(videoEl.currentTime);
            // Sync smooth time if it drifts too much
            if (Math.abs(videoEl.currentTime - smoothTime) > 0.5) {
                setSmoothTime(videoEl.currentTime);
            }
            // Save history periodically (approx every second or so)
            if (Math.floor(videoEl.currentTime) % 5 === 0) {
                saveHistory(videoEl.currentTime, currentSegmentIndex);
            }
        };

        const handleLoadedMetadata = () => {
            setDuration(videoEl.duration);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            if (currentSegmentIndex < session.segments.length - 1) {
                // Clear history seek ref so next segment starts at 0
                initialSeekTimeRef.current = 0;
                setCurrentSegmentIndex(prev => prev + 1);
            } else {
                // Finished all, maybe clear history for this session? Or keep as "watched"
            }
        };

        const handleError = (e: any) => {
            if (videoEl.error?.code === 20 || (videoEl.error as any)?.code === 'AbortError') return;
            if (videoEl.error?.code === 4) {
                if (isMounted) setErrorMsg("无法播放此视频格式 (The element has no supported sources)");
            } else {
                if (isMounted) setErrorMsg(`视频错误 code: ${videoEl.error?.code}`);
            }
        };

        videoEl.addEventListener('timeupdate', handleTimeUpdate);
        videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);
        videoEl.addEventListener('ended', handleEnded);
        videoEl.addEventListener('play', () => setIsPlaying(true));
        videoEl.addEventListener('pause', () => { setIsPlaying(false); saveHistory(videoEl.currentTime, currentSegmentIndex); });
        videoEl.addEventListener('error', handleError);

        return () => {
            isMounted = false;
            videoEl.removeEventListener('timeupdate', handleTimeUpdate);
            videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
            videoEl.removeEventListener('ended', handleEnded);
            videoEl.removeEventListener('play', () => setIsPlaying(true));
            videoEl.removeEventListener('pause', () => setIsPlaying(false));
            videoEl.removeEventListener('error', handleError);

            // Save on unmount
            saveHistory(videoEl.currentTime, currentSegmentIndex);

            if (player) {
                player.destroy();
                player = null;
            } else if (mpegtsPlayerRef.current) {
                mpegtsPlayerRef.current.destroy();
                mpegtsPlayerRef.current = null;
            }

            videoEl.removeAttribute('src');
            videoEl.load();
            URL.revokeObjectURL(fileUrl);
        };
    }, [currentSegment, currentSegmentIndex, session.segments.length]);

    // Filter visible chat: Show only Past and Current danmaku
    const visibleChatList = useMemo(() => {
        return danmakuData.filter(d => d.time <= currentTime);
    }, [danmakuData, currentTime]);

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

    const toggleFullscreen = () => {
        if (!containerRef.current) return;
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().then(() => {
                setIsFullscreen(true);
            }).catch(err => { });
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    useEffect(() => {
        const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFsChange);
        return () => document.removeEventListener('fullscreenchange', handleFsChange);
    }, []);

    const togglePlay = () => {
        if (videoRef.current) {
            if (videoRef.current.paused) {
                videoRef.current.play().catch(() => { });
            } else {
                videoRef.current.pause();
            }
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = time;
        }
        setCurrentTime(time);
        setSmoothTime(time);
        saveHistory(time, currentSegmentIndex);
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(e.target.value);
        setVolume(v);
        if (videoRef.current) videoRef.current.volume = v;
        setIsMuted(v === 0);
    };

    const toggleMute = () => {
        if (videoRef.current) {
            const nextMuted = !isMuted;
            videoRef.current.muted = nextMuted;
            videoRef.current.volume = nextMuted ? 0 : volume;
            setIsMuted(nextMuted);
        }
    };

    const formatTime = (time: number) => {
        if (!isFinite(time)) return "--:--";
        const h = Math.floor(time / 3600);
        const m = Math.floor((time % 3600) / 60);
        const s = Math.floor(time % 60);
        return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Overlay Filter
    const activeOverlayDanmaku = useMemo(() => {
        if (!danmakuSettings.show) return [];

        const BASE_DURATION = 16;

        // Anti-stacking / Smart speed logic
        // 1 char = 1.0x baseline
        // 10 chars = 0.75x baseline
        // Formula: factor = 1.0 - ((clamp(len, 1, 10) - 1) / 9) * 0.25

        // Conservatively filter using the slowest possible intrinsic speed (0.75x) 
        // to ensure we don't cull data that is still on screen.
        // maxDuration = 16 / (userSpeed * 0.75)
        const maxDuration = BASE_DURATION / (danmakuSettings.speed * 0.75);

        return danmakuData.filter(d =>
            d.time >= smoothTime - maxDuration && d.time <= smoothTime + 0.5
        ).map(d => {
            const len = d.content.length || 1;
            const clampedLen = Math.min(Math.max(len, 1), 10);
            const ratio = (clampedLen - 1) / 9; // 0 to 1
            const intrinsicFactor = 1.0 - (ratio * 0.25); // 1.0 to 0.75

            const actualDuration = BASE_DURATION / (danmakuSettings.speed * intrinsicFactor);
            return { ...d, actualDuration };
        }).filter(d => {
            // Second pass precise filter
            return d.time >= smoothTime - d.actualDuration && d.time <= smoothTime + 0.5;
        });
    }, [danmakuData, smoothTime, danmakuSettings.show, danmakuSettings.speed]);

    return (
        <div className="flex flex-col h-screen bg-white dark:bg-gray-900 transition-colors duration-300">
            {/* Top Bar */}
            {!isFullscreen && (
                <div className="h-14 flex items-center px-4 border-b border-gray-200 dark:border-gray-700 justify-between bg-white dark:bg-gray-800 z-20 shrink-0 transition-colors duration-300">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300 transition-colors">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <h1 className="font-semibold text-gray-800 dark:text-white line-clamp-1">{session.title}</h1>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <span>UP: {session.streamerName}</span>
                        <span>{new Date(session.startTime).toLocaleString()}</span>
                    </div>
                </div>
            )}

            <div className="flex-1 flex overflow-hidden">
                {/* Main Player Area */}
                <div className="flex-1 flex flex-col bg-black relative group" ref={containerRef}>
                    <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
                        {errorMsg ? (
                            <div className="text-white text-center p-4">
                                <p className="text-red-400 mb-2">播放出错</p>
                                <p className="text-sm text-gray-400">{errorMsg}</p>
                            </div>
                        ) : (
                            <video
                                ref={videoRef}
                                className="w-full h-full object-contain"
                                onClick={(e) => {
                                    if (wasLongPressRef.current) {
                                        wasLongPressRef.current = false;
                                        return;
                                    }
                                    togglePlay();
                                }}
                                onMouseDown={() => {
                                    wasLongPressRef.current = false;
                                    longPressTimeoutRef.current = setTimeout(() => {
                                        setIsLongPressing(true);
                                        wasLongPressRef.current = true;
                                    }, 200);
                                }}
                                onMouseUp={() => {
                                    if (longPressTimeoutRef.current) {
                                        clearTimeout(longPressTimeoutRef.current);
                                        longPressTimeoutRef.current = null;
                                    }
                                    setIsLongPressing(false);
                                }}
                                onMouseLeave={() => {
                                    if (longPressTimeoutRef.current) {
                                        clearTimeout(longPressTimeoutRef.current);
                                        longPressTimeoutRef.current = null;
                                    }
                                    setIsLongPressing(false);
                                }}
                                playsInline
                            />
                        )}

                        {/* Long Press Speed Indicator */}
                        {isLongPressing && !errorMsg && (
                            <div className="absolute top-8 left-1/2 transform -translate-x-1/2 bg-black/60 text-white px-3 py-1 rounded-full text-sm backdrop-blur-sm z-20 pointer-events-none animate-in fade-in zoom-in duration-200">
                                倍速中 x{danmakuSettings.longPressRate}
                            </div>
                        )}

                        {/* Danmaku Overlay */}
                        {danmakuSettings.show && !errorMsg && (
                            <div className="absolute inset-0 overflow-hidden pointer-events-none z-10 font-sans">
                                {activeOverlayDanmaku.map((d, i) => {
                                    // Smart Track Positioning
                                    const top = `${(d.trackIndex % 16) * 6}%`;
                                    // Use pre-calculated duration
                                    const duration = d.actualDuration;
                                    const timeAlive = smoothTime - d.time;
                                    const progress = timeAlive / duration;

                                    const startX = 100;
                                    const endX = -100;
                                    const currentX = startX - (progress * (startX - endX));

                                    const fontSize = 19.2 * danmakuSettings.size;
                                    const colorHex = d.color === 16777215 ? '#ffffff' : `#${d.color.toString(16).padStart(6, '0')}`;

                                    // Sticker Rendering (Large)
                                    if (d.stickerUrl) {
                                        return (
                                            <div
                                                key={`${d.timestamp}-${d.uid}-${i}`}
                                                className="absolute"
                                                style={{
                                                    top,
                                                    left: 0,
                                                    transform: `translateX(${currentX}vw)`,
                                                    opacity: danmakuSettings.opacity,
                                                    willChange: 'transform'
                                                }}
                                            >
                                                <img
                                                    src={d.stickerUrl}
                                                    alt="sticker"
                                                    className="h-12 w-auto object-contain" // Fixed height for stickers (h-16 = 64px)
                                                    referrerPolicy="no-referrer"
                                                />
                                            </div>
                                        );
                                    }

                                    // Text Rendering (with heavy black outline stroke)
                                    return (
                                        <div
                                            key={`${d.timestamp}-${d.uid}-${i}`}
                                            className="absolute whitespace-nowrap font-bold"
                                            style={{
                                                top,
                                                left: 0,
                                                transform: `translateX(${currentX}vw)`,
                                                fontSize: `${fontSize}px`,
                                                opacity: danmakuSettings.opacity,
                                                color: colorHex,
                                                // 4-direction heavy shadow to simulate black stroke
                                                textShadow: '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000',
                                                willChange: 'transform'
                                            }}
                                        >
                                            <DanmakuContent content={d.content} emots={d.emots} color={d.color} />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Controls */}
                    <div className={`h-12 bg-white/95 dark:bg-gray-800/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 flex items-center px-4 gap-4 z-20 transition-all duration-300 ${isFullscreen ? 'opacity-0 group-hover:opacity-100 absolute bottom-0 left-0 right-0' : ''}`}>
                        <button onClick={togglePlay} className="text-gray-700 dark:text-gray-200 hover:text-[#FB7299] dark:hover:text-[#FB7299]" disabled={!!errorMsg}>
                            {isPlaying ? <Pause className="fill-current w-5 h-5" /> : <Play className="fill-current w-5 h-5" />}
                        </button>

                        <span className="text-xs font-mono text-gray-500 dark:text-gray-400 w-24 text-center">
                            {formatTime(currentTime)} / {formatTime(duration || 0)}
                        </span>

                        {/* Seek Bar */}
                        <div className="flex-1 flex items-center">
                            <input
                                type="range"
                                min={0}
                                max={duration || 100}
                                step={0.1}
                                value={currentTime}
                                onChange={handleSeek}
                                disabled={!!errorMsg}
                                className="w-full h-1 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-[#FB7299] hover:h-1.5 transition-all"
                            />
                        </div>

                        {/* Right Side Controls */}
                        <div className="flex items-center gap-3">
                            {/* Volume */}
                            <div className="flex items-center gap-2 group/vol w-24">
                                <button onClick={toggleMute} className="text-gray-600 dark:text-gray-300 hover:text-[#FB7299]">
                                    {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                                </button>
                                <div className="w-0 overflow-hidden group-hover/vol:w-16 transition-all duration-300">
                                    <input
                                        type="range"
                                        min="0" max="1" step="0.05"
                                        value={isMuted ? 0 : volume}
                                        onChange={handleVolumeChange}
                                        className="w-16 h-1 accent-[#FB7299] bg-gray-300 dark:bg-gray-600 rounded-lg cursor-pointer"
                                    />
                                </div>
                            </div>

                            {/* Dan Toggle */}
                            <button
                                onClick={() => setDanmakuSettings(s => ({ ...s, show: !s.show }))}
                                className={`w-8 h-8 flex items-center justify-center rounded transition-colors font-bold select-none ${danmakuSettings.show ? 'text-[#FB7299] bg-[#FB7299]/10' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 line-through'}`}
                                title="开启/关闭弹幕"
                            >
                                弹
                            </button>

                            {/* Settings Toggle */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowSettings(!showSettings)}
                                    className={`p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${showSettings ? 'text-[#FB7299]' : 'text-gray-600 dark:text-gray-300'}`}
                                >
                                    <Settings className="w-5 h-5" />
                                </button>
                                {showSettings && (
                                    <div className="absolute bottom-12 right-0 bg-white dark:bg-gray-800 shadow-xl border border-gray-100 dark:border-gray-700 rounded-lg p-4 w-64 z-30">
                                        <h3 className="text-sm font-bold mb-3 text-gray-700 dark:text-white">弹幕设置</h3>
                                        <div className="space-y-4">
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                                    <span>不透明度</span>
                                                    <span>{Math.round(danmakuSettings.opacity * 100)}%</span>
                                                </div>
                                                <input
                                                    type="range" min="0.1" max="1" step="0.1"
                                                    value={danmakuSettings.opacity}
                                                    onChange={(e) => setDanmakuSettings({ ...danmakuSettings, opacity: parseFloat(e.target.value) })}
                                                    className="w-full h-1 bg-gray-200 dark:bg-gray-600 rounded accent-[#FB7299]"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                                    <span>字号缩放</span>
                                                    <span>{danmakuSettings.size}x</span>
                                                </div>
                                                <input
                                                    type="range" min="0.5" max="2" step="0.1"
                                                    value={danmakuSettings.size}
                                                    onChange={(e) => setDanmakuSettings({ ...danmakuSettings, size: parseFloat(e.target.value) })}
                                                    className="w-full h-1 bg-gray-200 dark:bg-gray-600 rounded accent-[#FB7299]"
                                                />
                                            </div>

                                            <div className="space-y-1">
                                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                                    <span>速度</span>
                                                    <span>{danmakuSettings.speed}x</span>
                                                </div>
                                                <input
                                                    type="range" min="0.5" max="2" step="0.25"
                                                    value={danmakuSettings.speed}
                                                    onChange={(e) => setDanmakuSettings({ ...danmakuSettings, speed: parseFloat(e.target.value) })}
                                                    className="w-full h-1 bg-gray-200 dark:bg-gray-600 rounded accent-[#FB7299]"
                                                />
                                            </div>

                                            <div className="h-px bg-gray-100 dark:bg-gray-700 my-2"></div>
                                            <h3 className="text-sm font-bold text-gray-700 dark:text-white">播放设置</h3>

                                            <div className="space-y-1">
                                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                                    <span>倍速播放</span>
                                                    <span>{danmakuSettings.playbackRate}x</span>
                                                </div>
                                                <input
                                                    type="range" min="0.25" max="3.0" step="0.25"
                                                    value={danmakuSettings.playbackRate}
                                                    onChange={(e) => setDanmakuSettings({ ...danmakuSettings, playbackRate: parseFloat(e.target.value) })}
                                                    className="w-full h-1 bg-gray-200 dark:bg-gray-600 rounded accent-[#FB7299]"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">长按倍速</span>
                                                <div className="flex bg-gray-100 dark:bg-gray-700 p-0.5 rounded text-xs">
                                                    {[2.0, 3.0].map(rate => (
                                                        <button
                                                            key={rate}
                                                            onClick={() => setDanmakuSettings({ ...danmakuSettings, longPressRate: rate })}
                                                            className={`flex-1 py-1 rounded transition-all ${danmakuSettings.longPressRate === rate
                                                                ? 'bg-white dark:bg-gray-600 text-[#FB7299] shadow-sm font-bold'
                                                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                                                }`}
                                                        >
                                                            {rate}x
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Fullscreen */}
                            <button
                                onClick={toggleFullscreen}
                                className="p-2 text-gray-600 dark:text-gray-300 hover:text-[#FB7299] hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                            >
                                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    {/* Segment Selector (P list) */}
                    {session.segments.length > 1 && !isFullscreen && (
                        <div className="h-10 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 overflow-x-auto scrollbar-thin shrink-0 transition-colors duration-300">
                            <span className="text-xs font-bold mr-3 text-gray-500 dark:text-gray-400 shrink-0">分P选集</span>
                            {session.segments.map((seg, idx) => {
                                const startTimeFormatted = formatSegmentTime(seg.file.timestamp);
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            setCurrentSegmentIndex(idx);
                                        }}
                                        className={`flex-shrink-0 px-3 py-1 text-xs rounded mr-2 transition-colors border ${idx === currentSegmentIndex
                                            ? 'bg-[#FB7299] text-white border-[#FB7299]'
                                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                                            }`}
                                        title={seg.file.name}
                                    >
                                        {startTimeFormatted}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Chat / Danmaku List Sidebar - Hidden in fullscreen usually, or overlay. For now hide. */}
                {!isFullscreen && (
                    <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col shrink-0 font-sans transition-colors duration-300">
                        <div className="h-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 justify-between shrink-0">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">弹幕列表 ({visibleChatList.length})</span>
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
                )}
            </div>
        </div >
    );
};

export default Player;