import React, { useEffect, useRef, useState, useMemo } from 'react';
import { DanmakuItem } from '../types';
import DanmakuContent from './DanmakuContent';

interface DanmakuSettings {
    show: boolean;
    opacity: number;
    size: number;
    speed: number;
    playbackRate: number;
    longPressRate: number;
}

interface FilterSettings {
    medalFilterEnabled: boolean;
    minMedalLevel: number;
    blockedKeywords: string[];
}

interface DanmakuLayerProps {
    show: boolean;
    danmakuData: DanmakuItem[];
    danmakuSettings: DanmakuSettings;
    filterSettings: FilterSettings;
    videoRef: React.RefObject<HTMLVideoElement>;
    isPlaying: boolean;
    currentTime: number;
    searchStartIndexRef: React.MutableRefObject<number>;
}

const DanmakuLayer: React.FC<DanmakuLayerProps> = React.memo(({ show, danmakuData, danmakuSettings, filterSettings, videoRef, isPlaying, currentTime, searchStartIndexRef }) => {
    const [smoothTime, setSmoothTime] = useState(currentTime);
    const lastUpdateRef = useRef(performance.now());
    const lastVideoTimeRef = useRef(currentTime);
    const animationFrameRef = useRef<number>();

    // Animation Loop with High Precision Interpolation
    useEffect(() => {
        const update = () => {
            const video = videoRef.current;
            if (video && !video.paused && video.readyState >= 3) {
                const now = performance.now();
                const vTime = video.currentTime;

                // If video time changed (a new "tick" from the engine), sync our base
                if (vTime !== lastVideoTimeRef.current) {
                    lastVideoTimeRef.current = vTime;
                    lastUpdateRef.current = now;
                    setSmoothTime(vTime);
                } else {
                    // Otherwise interpolate based on elapsed real time and playback rate
                    const elapsed = (now - lastUpdateRef.current) / 1000;
                    const playbackRate = videoRef.current.playbackRate || 1;
                    setSmoothTime(vTime + elapsed * playbackRate);
                }

                animationFrameRef.current = requestAnimationFrame(update);
            }
        };

        if (isPlaying) {
            lastUpdateRef.current = performance.now();
            lastVideoTimeRef.current = videoRef.current?.currentTime || currentTime;
            animationFrameRef.current = requestAnimationFrame(update);
        } else {
            setSmoothTime(currentTime);
            lastVideoTimeRef.current = currentTime;
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        }

        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [isPlaying, currentTime, videoRef]);

    const activeOverlayDanmaku = useMemo(() => {
        if (!show || danmakuData.length === 0) return [];

        const BASE_DURATION = 16;
        const maxDuration = BASE_DURATION / (danmakuSettings.speed * 0.75);
        const startTimeWindow = smoothTime - maxDuration;
        const endTimeWindow = smoothTime + 0.5;

        let startIndex = searchStartIndexRef.current;
        if (danmakuData[startIndex] && danmakuData[startIndex].time > startTimeWindow + 10) {
            startIndex = 0;
        }

        while (startIndex < danmakuData.length - 1 && danmakuData[startIndex].time < startTimeWindow) {
            startIndex++;
        }
        searchStartIndexRef.current = startIndex;

        const result: (DanmakuItem & { actualDuration: number })[] = [];
        for (let i = startIndex; i < danmakuData.length; i++) {
            const d = danmakuData[i];
            if (d.time > endTimeWindow) break;

            const len = d.content.length || 1;
            const clampedLen = len > 10 ? 10 : (len < 1 ? 1 : len);
            const ratio = (clampedLen - 1) * 0.1111;
            const intrinsicFactor = 1.0 - (ratio * 0.25);
            const actualDuration = BASE_DURATION / (danmakuSettings.speed * intrinsicFactor);

            if (d.time >= smoothTime - actualDuration) {
                // Apply Filter rules
                if (filterSettings.medalFilterEnabled && (d.medalLevel || 0) < filterSettings.minMedalLevel) {
                    continue;
                }
                if (filterSettings.blockedKeywords.length > 0) {
                    const content = d.content.toLowerCase();
                    if (filterSettings.blockedKeywords.some(k => content.includes(k.toLowerCase()))) {
                        continue;
                    }
                }

                result.push({ ...d, actualDuration });
            }
        }
        return result;
    }, [danmakuData, smoothTime, show, danmakuSettings.speed, danmakuSettings.size, searchStartIndexRef, filterSettings]);

    if (!show) return null;

    return (
        <div
            className="absolute inset-0 overflow-hidden pointer-events-none z-10 font-sans"
            style={{ containerType: 'inline-size' } as any} // Enable cqw units
        >
            {activeOverlayDanmaku.map((d, i) => {
                const top = `${(d.trackIndex % 16) * 6}%`;
                const progress = (smoothTime - d.time) / d.actualDuration;

                // Use cqw (Container Query Width) instead of vw to stick to the video area
                const startX = 100;
                const endX = -40;
                const currentX = startX - (progress * (startX - endX));

                const fontSize = 19.2 * danmakuSettings.size;
                const colorHex = d.color === 16777215 ? '#ffffff' : `#${d.color.toString(16).padStart(6, '0')}`;

                if (d.stickerUrl) {
                    return (
                        <div key={`${d.timestamp}-${d.uid}-${i}`} className="absolute" style={{ top, left: 0, transform: `translateX(${currentX}cqw) translateZ(0)`, opacity: danmakuSettings.opacity, willChange: 'transform' }}>
                            <img src={d.stickerUrl} alt="sticker" className="h-12 w-auto object-contain" referrerPolicy="no-referrer" />
                        </div>
                    );
                }

                return (
                    <div key={`${d.timestamp}-${d.uid}-${i}`} className="absolute whitespace-nowrap font-bold" style={{ top, left: 0, transform: `translateX(${currentX}cqw) translateZ(0)`, fontSize: `${fontSize}px`, opacity: danmakuSettings.opacity, color: colorHex, textShadow: '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000', willChange: 'transform' }}>
                        <DanmakuContent content={d.content} emots={d.emots} color={d.color} />
                    </div>
                );
            })}
        </div>
    );
});

export default DanmakuLayer;
