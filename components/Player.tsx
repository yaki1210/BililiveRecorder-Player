import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ArrowLeft, Play, Pause, Volume2, VolumeX, Settings, Maximize, Minimize, Loader2, AlertCircle } from 'lucide-react';
import { StreamSession, DanmakuItem, StreamSegment } from '../types';
import { parseDanmakuXml, formatSegmentTime, scanSessionDanmakuDensity } from '../utils/parser';
import mpegts from 'mpegts.js';
import DanmakuContent from './DanmakuContent';
import DanmakuLayer from './DanmakuLayer';
import SegmentSelector from './SegmentSelector';
import ChatList from './ChatList';
import DanmakuDensityCurve from './DanmakuDensityCurve';

interface PlayerProps {
    session: StreamSession;
    onBack: () => void;
}


const STORAGE_KEY_SETTINGS = 'bili-player-settings';
const STORAGE_KEY_HISTORY = 'bili-player-history';
const STORAGE_KEY_VOLUME = 'bili-player-volume';
const STORAGE_KEY_FILTER = 'bili-player-filter-settings';

const Player: React.FC<PlayerProps> = ({ session, onBack }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const mpegtsPlayerRef = useRef<any>(null);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const wasLongPressRef = useRef(false);

    // Stall detection refs
    const lastTimeRef = useRef(0);
    const stallCountRef = useRef(0);

    // Player State
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(0); // Driven by timeupdate (low freq)
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY_VOLUME);
        if (saved) {
            try {
                const { volume } = JSON.parse(saved);
                return typeof volume === 'number' ? volume : 1;
            } catch (e) { }
        }
        return 1;
    });
    const [isMuted, setIsMuted] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY_VOLUME);
        if (saved) {
            try {
                const { isMuted } = JSON.parse(saved);
                return typeof isMuted === 'boolean' ? isMuted : false;
            } catch (e) { }
        }
        return false;
    });
    const [isLongPressing, setIsLongPressing] = useState(false); // Long press for speed
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    // Global Danmaku Bins
    const [globalDensityBins, setGlobalDensityBins] = useState<number[] | undefined>(undefined);

    // Virtual Timeline State
    const [realDurations, setRealDurations] = useState<Record<number, number>>({});

    // Calculate Global Timeline
    // Calculate Global Timeline - Grid is fixed based on metadata to prevent visual drift
    const timeline = useMemo(() => {
        let acc = 0;
        return session.segments.map((seg, idx) => {
            // Priority: seg.duration (XML metadata) is the anchor for the visual grid
            let dur = seg.duration || 0;

            // Fallback to timestamp estimate if metadata is missing
            if (dur === 0) {
                const next = session.segments[idx + 1];
                if (next) {
                    dur = (next.file.timestamp - seg.file.timestamp) / 1000;
                } else {
                    // Only use real duration if absolutely no other anchor exists
                    dur = realDurations[idx] || 0;
                }
            }
            if (dur < 0) dur = 0;

            const start = acc;
            acc += dur;
            return {
                start,
                end: acc,
                duration: dur
            };
        });
        // Remove realDurations from direct visual grid dependency if possible 
        // to prevent the "after-click adjustment" jump.
    }, [session.segments, realDurations]);

    const totalDuration = timeline[timeline.length - 1]?.end || 0;
    const globalCurrentTime = (timeline[currentSegmentIndex]?.start || 0) + currentTime;

    // Danmaku optimization: Ref-based sliding window (no re-renders)
    const searchStartIndexRef = useRef(0);

    // Controls visibility
    const [showControls, setShowControls] = useState(true);
    const controlsTimeoutRef = useRef<NodeJS.Timeout>();

    const [showSettings, setShowSettings] = useState(false);

    const resetControlsTimer = useCallback(() => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying && !showSettings) {
                setShowControls(false);
            }
        }, 2500);
    }, [isPlaying, showSettings]);

    useEffect(() => {
        resetControlsTimer();
        return () => {
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        };
    }, [isPlaying, resetControlsTimer]);

    // Danmaku State
    // Defaults normalized to 1.0
    const [danmakuData, setDanmakuData] = useState<DanmakuItem[]>([]);

    // Load settings from storage
    const [danmakuSettings, setDanmakuSettings] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
        if (saved) {
            try {
                return {
                    ...{ show: true, opacity: 1, size: 1.0, speed: 1.0, playbackRate: 1.0, longPressRate: 2.0, timelineMode: 'global' },
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
            timelineMode: 'global',
        };
    });
    const [filterSettings, setFilterSettings] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY_FILTER);
        if (saved) {
            try {
                return {
                    medalFilterEnabled: false,
                    minMedalLevel: 0,
                    blockedKeywords: [] as string[],
                    ...JSON.parse(saved)
                };
            } catch (e) { }
        }
        return {
            medalFilterEnabled: false,
            minMedalLevel: 0,
            blockedKeywords: [] as string[],
        };
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_FILTER, JSON.stringify(filterSettings));
    }, [filterSettings]);


    const currentSegment = session.segments[currentSegmentIndex];

    // Save settings (excluding playbackRate)
    useEffect(() => {
        const { playbackRate, ...toSave } = danmakuSettings;
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(toSave));
    }, [danmakuSettings]);

    // Save volume settings
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_VOLUME, JSON.stringify({ volume, isMuted }));
    }, [volume, isMuted]);

    const initialSeekTimeRef = useRef<number | null>(null);
    const hasLoadedHistoryRef = useRef(false);

    // History: Load on mount (session change)
    useEffect(() => {
        if (hasLoadedHistoryRef.current) return;

        try {
            const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
            if (raw) {
                const history = JSON.parse(raw);
                const record = history[session.id];

                if (record) {
                    // Modern format: has globalTime
                    if (typeof record.globalTime === 'number') {
                        const globalTime = record.globalTime;
                        let targetIdx = timeline.findIndex(t => globalTime >= t.start && globalTime < t.end);
                        if (targetIdx === -1) targetIdx = timeline.length - 1;

                        const segmentStartTime = timeline[targetIdx]?.start || 0;
                        const localTime = Math.max(0, globalTime - segmentStartTime);

                        setCurrentSegmentIndex(targetIdx);
                        initialSeekTimeRef.current = localTime;
                    }
                    // Legacy format detected: has time but no globalTime
                    else if (record.time !== undefined || record.segmentIndex !== undefined) {
                        console.log("Cleaning up legacy history record for session", session.id);
                        delete history[session.id];
                        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
                    }
                }
                // Mark as loaded even if no valid record found, to prevent re-processing on timeline updates
                hasLoadedHistoryRef.current = true;
            } else {
                // If no history at all, still mark as checked
                hasLoadedHistoryRef.current = true;
            }
        } catch (e) {
            console.error("Failed to load history", e);
            hasLoadedHistoryRef.current = true;
        }
    }, [session.id, timeline]);

    // Reset history load flag on session change
    useEffect(() => {
        hasLoadedHistoryRef.current = false;
        setGlobalDensityBins(undefined); // Clear old session's bins
    }, [session.id]);

    // Load Global Danmaku Density
    useEffect(() => {
        const loadGlobalDensity = async () => {
            // Wait for a basic duration estimate if not yet available
            if (totalDuration <= 0) return;
            const bins = await scanSessionDanmakuDensity(session.segments, totalDuration);
            setGlobalDensityBins(bins);
        };
        loadGlobalDensity();
    }, [session.id, session.segments, totalDuration]);

    const saveHistory = useCallback((globalTime: number) => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
            let history = raw ? JSON.parse(raw) : {};

            history[session.id] = {
                globalTime,
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
                    // Ensure sorted by time for linear scan optimization
                    items.sort((a, b) => a.time - b.time);
                    setDanmakuData(items);
                    searchStartIndexRef.current = 0;
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

    // Stall Detection & Auto-Recovery
    useEffect(() => {
        const checkStall = setInterval(() => {
            if (videoRef.current && !videoRef.current.paused && isPlaying) {
                const nowTime = videoRef.current.currentTime;
                if (Math.abs(nowTime - lastTimeRef.current) < 0.1) {
                    stallCountRef.current++;
                    if (stallCountRef.current > 2) setIsLoading(true);
                    if (stallCountRef.current > 6) {
                        if (videoRef.current) {
                            console.warn("Stall detected, skipping 1s");
                            videoRef.current.currentTime += 1;
                            stallCountRef.current = 0;
                        }
                    }
                } else {
                    stallCountRef.current = 0;
                    if (videoRef.current.readyState > 2) setIsLoading(false);
                }
                lastTimeRef.current = nowTime;
            }
        }, 500);
        return () => clearInterval(checkStall);
    }, [isPlaying]);

    // Seek interaction state
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = useRef(false);

    // Initialize Player
    useEffect(() => {
        let isMounted = true;
        setErrorMsg(null);
        setIsPlaying(false);
        setIsLoading(true);
        setToastMessage(null);

        // Reset stall detection
        lastTimeRef.current = 0;
        stallCountRef.current = 0;

        const startTime = initialSeekTimeRef.current !== null ? initialSeekTimeRef.current : 0;
        setCurrentTime(startTime);

        if (!videoRef.current || !currentSegment.file) return;

        const videoEl = videoRef.current;
        const fileUrl = URL.createObjectURL(currentSegment.file.originalFile);
        const type = currentSegment.file.ext.toLowerCase();
        let player: any = null;

        videoEl.volume = isMuted ? 0 : volume;

        const setupPlayer = async () => {
            videoEl.removeAttribute('src');
            videoEl.load();

            const onPlayerReady = () => {
                if (initialSeekTimeRef.current !== null) {
                    videoEl.currentTime = initialSeekTimeRef.current;
                    initialSeekTimeRef.current = null;
                }
                setIsLoading(false);
            };

            const onWaiting = () => setIsLoading(true);
            const onCanPlay = () => setIsLoading(false);

            // Bind early to catch native events
            videoEl.addEventListener('waiting', onWaiting);
            videoEl.addEventListener('playing', onCanPlay);
            videoEl.addEventListener('canplay', onCanPlay);

            if (type === 'flv') {
                if (mpegts && mpegts.isSupported()) {
                    try {
                        player = mpegts.createPlayer({
                            type: 'flv',
                            url: fileUrl,
                            isLive: false,
                            hasAudio: true,
                            hasVideo: true,
                        }, {
                            enableWorker: true, // Enable Web Worker to offload CPU tasks
                            lazyLoad: true,
                            lazyLoadMaxDuration: 3 * 60,
                            lazyLoadRecoverDuration: 30,
                            deferLoadAfterSourceOpen: false,
                            autoCleanupSourceBuffer: true,
                            autoCleanupMaxBackwardDuration: 60,
                            autoCleanupMinBackwardDuration: 30,
                            stashInitialSize: 128 * 1024,
                            seekType: 'range',
                            accurateSeek: false,
                        });
                        player.attachMediaElement(videoEl);
                        player.load();

                        if (isMounted) {
                            mpegtsPlayerRef.current = player;
                            player.on(mpegts.Events.ERROR, (type: any, details: any, data: any) => {
                                console.warn('Mpegts Error:', type, details, data);
                            });
                            player.on(mpegts.Events.LOADING_COMPLETE, () => setIsLoading(false));
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
                        setIsLoading(false);
                    }
                } else {
                    if (isMounted) setErrorMsg("浏览器不支持 FLV 播放，且未检测到 mpegts.js 组件");
                    setIsLoading(false);
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
            if (!isDraggingRef.current) {
                setCurrentTime(videoEl.currentTime);
                if (Math.floor(videoEl.currentTime) % 5 === 0) {
                    const currentSegStart = timeline[currentSegmentIndex]?.start || 0;
                    saveHistory(currentSegStart + videoEl.currentTime);
                }
            }
        };

        const handleLoadedMetadata = () => {
            setDuration(videoEl.duration);
            // Update real duration for timeline
            if (videoEl.duration && videoEl.duration > 0) {
                setRealDurations(prev => {
                    // Update if simplified duration mismatch is significant enough to cause visual drift
                    // Lower threshold to 0.01s to ensure precise mapping
                    if (Math.abs((prev[currentSegmentIndex] || 0) - videoEl.duration) > 0.01) {
                        return { ...prev, [currentSegmentIndex]: videoEl.duration };
                    }
                    return prev;
                });
            }
        };

        const handleEnded = () => {
            // Auto-switch is now handled by the virtual timeline logic?
            // Actually standard 'ended' event is fine for exact end.
            // But user also wants "close to start time of next".
            // If the files are split, `ended` works perfectly.
            // The "close to" logic might be for pre-fetching or if the file duration is slightly off?
            // Let's stick to `ended` for reliable checks, but add a proximity check in timeUpdate if we want truly seamless.
            // For now, standard `ended` is the most robust trigger for switching.

            if (currentSegmentIndex < session.segments.length - 1) {
                // Check if we should merge? (Always merge in this view)
                setIsPlaying(true); // Keep playing status
                initialSeekTimeRef.current = 0;
                setCurrentTime(0); // Reset UI immediately
                setCurrentSegmentIndex(prev => prev + 1);
            } else {
                setIsPlaying(false);
            }
        };

        const handleError = (e: any) => {
            if (videoEl.error?.code === 20 || (videoEl.error as any)?.code === 'AbortError') return;
            if (videoEl.error?.code === 4) {
                if (isMounted) setErrorMsg("无法播放此视频格式 (The element has no supported sources)");
            } else {
                if (isMounted) setErrorMsg(`视频错误 code: ${videoEl.error?.code}`);
            }
            setIsLoading(false);
        };

        // Listeners
        const onWaiting = () => setIsLoading(true);
        const onCanPlay = () => setIsLoading(false);

        videoEl.addEventListener('timeupdate', handleTimeUpdate);
        videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);
        videoEl.addEventListener('ended', handleEnded);
        videoEl.addEventListener('waiting', onWaiting);
        videoEl.addEventListener('playing', onCanPlay);
        videoEl.addEventListener('canplay', onCanPlay);
        videoEl.addEventListener('play', () => setIsPlaying(true));
        videoEl.addEventListener('pause', () => {
            setIsPlaying(false);
            const currentSegStart = timeline[currentSegmentIndex]?.start || 0;
            saveHistory(currentSegStart + videoEl.currentTime);
        });
        videoEl.addEventListener('error', handleError);

        return () => {
            isMounted = false;
            videoEl.removeEventListener('timeupdate', handleTimeUpdate);
            videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
            videoEl.removeEventListener('ended', handleEnded);
            videoEl.removeEventListener('waiting', onWaiting);
            videoEl.removeEventListener('playing', onCanPlay);
            videoEl.removeEventListener('canplay', onCanPlay);
            videoEl.removeEventListener('play', () => setIsPlaying(true));
            videoEl.removeEventListener('pause', () => setIsPlaying(false));
            videoEl.removeEventListener('error', handleError);

            const currentSegStart = timeline[currentSegmentIndex]?.start || 0;
            saveHistory(currentSegStart + videoEl.currentTime);

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
    }, [currentSegment, currentSegmentIndex, session.segments.length]); // timeline dependency removed to avoid re-init loop, handled via realDurations update

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

    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // UI Slider value (Global Time)
        // We only update local display state while dragging
        // Actual seek happens on handleSeekEnd using this value
        const globalTime = parseFloat(e.target.value);

        // Find which segment this global time belongs to
        const targetSegIdx = timeline.findIndex(t => globalTime >= t.start && globalTime < t.end);
        // Clamp to last segment if out of bounds (e.g. at very end)
        const finalSegIdx = targetSegIdx !== -1 ? targetSegIdx : timeline.length - 1;

        const segStart = timeline[finalSegIdx]?.start || 0;
        const localTime = globalTime - segStart;

        // If we are dragging across segments, we might want to update the preview
        // But switching video source while dragging is heavy. 
        // We just update `currentTime` (local) for the UI if we are in the SAME segment.
        // If we crossed segments, `currentTime` needs to be relative to that segment.

        // For smoother UI: just update the local input state?
        // Actually, `currentTime` is used for the video. 
        // Let's just store a "draggingTime" if needed, but here we reuse currentTime.

        // Warning: changing `currentSegmentIndex` here would trigger reload.
        // We should ONLY seek when drag ends.

        // Temporarily calculate local time for display purposes
        // But we can't easily show "future segment" frames without loading it.
        // So just update the slider position visually.

        // We need a separate state for "Slider Value" if we want to decouple?
        // `currentTime` is coupled to video.

        // Simplification: We only support seeking within the current segment LIVE, 
        // or Cross-segment seek on DROP.
        // But the slider is 0..Total.

        // Let's rely on standard HTML behavior:
        // We don't update video.currentTime while dragging across segments.
        // We can forceUpdate the slider value.
        // But `value={currentTime}` in the input implies local time?
        // No, we will change input value to `globalCurrentTime`.
    };

    const [dragGlobalTime, setDragGlobalTime] = useState<number | null>(null);

    const handleGlobalSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setDragGlobalTime(val);

        // If dragging within the same segment, we can update currentTime locally 
        // to make the dot follow the mouse precisely without waiting for handleGlobalSeekEnd
        const targetSegIdx = timeline.findIndex(t => val >= t.start && val < t.end);
        if (targetSegIdx !== -1 && targetSegIdx === currentSegmentIndex) {
            const segStart = timeline[targetSegIdx]?.start || 0;
            setCurrentTime(val - segStart);
        }
    };

    const handleSeekStart = () => {
        setIsDragging(true);
        isDraggingRef.current = true;
    };

    const handleGlobalSeekEnd = () => {
        if (dragGlobalTime !== null) {
            const seekPoint = dragGlobalTime;

            // Calculate target segment
            let targetIdx = timeline.findIndex(t => seekPoint >= t.start && seekPoint < t.end);
            if (targetIdx === -1) {
                targetIdx = seekPoint >= totalDuration ? timeline.length - 1 : 0;
            }

            const segInfo = timeline[targetIdx];
            const targetLocal = Math.max(0, Math.min(seekPoint - segInfo.start, (segInfo.duration || 10000) - 0.1));

            // Optimistic update: keep dragGlobalTime until the next timeupdate from the core
            // (or just clear it, but we set currentTime immediately)

            if (targetIdx !== currentSegmentIndex) {
                initialSeekTimeRef.current = targetLocal;
                setCurrentSegmentIndex(targetIdx);
                setCurrentTime(targetLocal);
            } else {
                if (videoRef.current) {
                    videoRef.current.currentTime = targetLocal;
                    setCurrentTime(targetLocal);
                }
            }
            saveHistory(seekPoint);
        }

        // Use a tiny delay to clear dragging state to allow React to flush the state updates 
        // to currentSegmentIndex and currentTime first, preventing the "jump to 0" flicker.
        setTimeout(() => {
            setIsDragging(false);
            isDraggingRef.current = false;
            setDragGlobalTime(null);
        }, 50);
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

    // Simplified formatTime
    const formatTime = (time: number) => {
        if (!isFinite(time)) return "--:--";
        const h = Math.floor(time / 3600);
        const m = Math.floor((time % 3600) / 60);
        const s = Math.floor(time % 60);
        return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

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
                <div
                    className={`flex-1 flex flex-col bg-black relative group min-w-0 ${!showControls ? 'cursor-none' : ''}`}
                    ref={containerRef}
                    onMouseMove={resetControlsTimer}
                    onClick={resetControlsTimer}
                >
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
                                preload="auto"
                                playsInline
                            />
                        )}

                        {/* Loading Spinner */}
                        {isLoading && !errorMsg && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
                                <Loader2 className="w-10 h-10 text-[#FB7299] animate-spin" />
                            </div>
                        )}

                        {/* Toast Notification (Stall Recovery) */}
                        {toastMessage && (
                            <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-sm z-40 pointer-events-none animate-in fade-in zoom-in slide-in-from-top-4 duration-300 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-[#FB7299]" />
                                {toastMessage}
                            </div>
                        )}

                        {/* Long Press Speed Indicator */}
                        {isLongPressing && !errorMsg && (
                            <div className="absolute top-8 left-1/2 transform -translate-x-1/2 bg-black/60 text-white px-3 py-1 rounded-full text-sm backdrop-blur-sm z-20 pointer-events-none animate-in fade-in zoom-in duration-200">
                                倍速中 x{danmakuSettings.longPressRate}
                            </div>
                        )}

                        {/* Danmaku Overlay - Isolated for Performance */}
                        <DanmakuLayer
                            show={danmakuSettings.show && !errorMsg}
                            danmakuData={danmakuData}
                            danmakuSettings={danmakuSettings}
                            filterSettings={filterSettings}
                            videoRef={videoRef}
                            isPlaying={isPlaying}
                            currentTime={currentTime}
                            searchStartIndexRef={searchStartIndexRef}
                        />

                        {/* Overlay Controls */}
                        <div className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-500 transform ${showControls ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'}`}>
                            {/* Gradient Overlay for legibility */}
                            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

                            <div className="relative h-14 flex items-center px-4 gap-4">
                                <button onClick={togglePlay} className="text-white hover:text-[#FB7299] drop-shadow-lg" disabled={!!errorMsg}>
                                    {isPlaying ? <Pause className="fill-current w-5 h-5" /> : <Play className="fill-current w-5 h-5" />}
                                </button>

                                <span className="text-xs font-mono text-white w-24 text-center drop-shadow-md">
                                    {danmakuSettings.timelineMode === 'global' ? (
                                        <>
                                            {formatTime(isDragging && dragGlobalTime !== null ? dragGlobalTime : globalCurrentTime)} / {formatTime(totalDuration)}
                                        </>
                                    ) : (
                                        <>
                                            {formatTime(currentTime)} / {formatTime(duration || 0)}
                                        </>
                                    )}
                                </span>

                                {/* Seek Bar */}
                                <div className="flex-1 flex items-center group/seek relative h-6">
                                    {danmakuSettings.timelineMode === 'global' ? (
                                        <>
                                            <div className="absolute bottom-full pointer-events-none transition-all duration-300 w-full">
                                                <DanmakuDensityCurve bins={globalDensityBins} duration={totalDuration} />
                                            </div>

                                            {/* Virtual segments indicators */}
                                            <div className="absolute inset-0 pointer-events-none flex">
                                                {timeline.map((t, idx) => (
                                                    <div key={idx} style={{ left: `${(t.start / totalDuration) * 100}%` }} className="absolute h-full w-px bg-white/20 z-0" />
                                                ))}
                                            </div>

                                            <input
                                                type="range"
                                                min={0}
                                                max={totalDuration || 100}
                                                step={0.1}
                                                value={dragGlobalTime !== null ? dragGlobalTime : globalCurrentTime}
                                                onChange={handleGlobalSeekChange}
                                                onMouseDown={handleSeekStart}
                                                onMouseUp={handleGlobalSeekEnd}
                                                onTouchStart={handleSeekStart}
                                                onTouchEnd={handleGlobalSeekEnd}
                                                disabled={!!errorMsg}
                                                className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-[#FB7299] hover:h-1.5 transition-all relative z-10"
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <DanmakuDensityCurve danmakuData={danmakuData} duration={duration} />
                                            <input
                                                type="range"
                                                min={0}
                                                max={duration || 100}
                                                step={0.1}
                                                value={currentTime}
                                                onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                                                onMouseDown={handleSeekStart}
                                                onMouseUp={() => {
                                                    setIsDragging(false);
                                                    isDraggingRef.current = false;
                                                    if (videoRef.current) videoRef.current.currentTime = currentTime;
                                                }}
                                                onTouchStart={handleSeekStart}
                                                onTouchEnd={() => {
                                                    setIsDragging(false);
                                                    isDraggingRef.current = false;
                                                    if (videoRef.current) videoRef.current.currentTime = currentTime;
                                                }}
                                                disabled={!!errorMsg}
                                                className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-[#FB7299] hover:h-1.5 transition-all relative z-10"
                                            />
                                        </>
                                    )}
                                </div>

                                {/* Right Side Controls */}
                                <div className="flex items-center gap-3">
                                    {/* Volume */}
                                    <div className="flex items-center gap-2 group/vol w-24">
                                        <button onClick={toggleMute} className="text-white hover:text-[#FB7299]">
                                            {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                                        </button>
                                        <div className="w-0 overflow-hidden group-hover/vol:w-16 transition-all duration-300">
                                            <input
                                                type="range"
                                                min="0" max="1" step="0.05"
                                                value={isMuted ? 0 : volume}
                                                onChange={handleVolumeChange}
                                                className="w-16 h-1 accent-[#FB7299] bg-white/30 rounded-lg cursor-pointer"
                                            />
                                        </div>
                                    </div>

                                    {/* Dan Toggle */}
                                    <button
                                        onClick={() => setDanmakuSettings(s => ({ ...s, show: !s.show }))}
                                        className={`w-8 h-8 flex items-center justify-center rounded transition-colors font-bold select-none ${danmakuSettings.show ? 'text-[#FB7299] bg-[#FB7299]/10' : 'text-white/60 hover:bg-white/10 line-through'}`}
                                        title="开启/关闭弹幕"
                                    >
                                        弹
                                    </button>

                                    {/* Settings Toggle */}
                                    <div className="relative">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
                                            className={`p-2 rounded hover:bg-white/10 ${showSettings ? 'text-[#FB7299]' : 'text-white'}`}
                                        >
                                            <Settings className="w-5 h-5" />
                                        </button>
                                        {showSettings && (
                                            <div
                                                className="absolute bottom-14 right-0 bg-white dark:bg-gray-800 shadow-2xl border border-gray-100 dark:border-gray-700 rounded-lg p-4 w-64 z-[100]"
                                                onClick={(e) => e.stopPropagation()}
                                            >
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
                                                        <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">进度条模式</span>
                                                        <div className="flex bg-gray-100 dark:bg-gray-700 p-0.5 rounded text-xs">
                                                            {[
                                                                { id: 'global', label: '全局' },
                                                                { id: 'segment', label: '分P' }
                                                            ].map(mode => (
                                                                <button
                                                                    key={mode.id}
                                                                    onClick={() => setDanmakuSettings({ ...danmakuSettings, timelineMode: mode.id as any })}
                                                                    className={`flex-1 py-1 rounded transition-all ${danmakuSettings.timelineMode === mode.id
                                                                        ? 'bg-white dark:bg-gray-600 text-[#FB7299] shadow-sm font-bold'
                                                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                                                        }`}
                                                                >
                                                                    {mode.label}
                                                                </button>
                                                            ))}
                                                        </div>
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
                                        className="p-2 text-white hover:text-[#FB7299] rounded"
                                    >
                                        {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Segment Selector (P list) - Clean Horizontal Scroll */}
                    <SegmentSelector
                        segments={session.segments}
                        currentSegmentIndex={currentSegmentIndex}
                        onSelect={(idx) => {
                            initialSeekTimeRef.current = 0; // Explicitly reset local seek when switching from list
                            setCurrentSegmentIndex(idx);
                        }}
                        isFullscreen={isFullscreen}
                    />
                </div >

                {/* Chat / Danmaku List Sidebar */}
                <ChatList
                    danmakuData={danmakuData}
                    currentTime={currentTime}
                    currentSegment={currentSegment}
                    isFullscreen={isFullscreen}
                    filterSettings={filterSettings}
                    setFilterSettings={setFilterSettings}
                />
            </div >
        </div >
    );
};

export default Player;
