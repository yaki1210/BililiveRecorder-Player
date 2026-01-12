import React, { useMemo } from 'react';
import { DanmakuItem } from '../types';

interface DanmakuDensityCurveProps {
    danmakuData?: DanmakuItem[];
    duration: number;
    bins?: number[]; // Added: support pre-calculated bins for global view
}

const DanmakuDensityCurve: React.FC<DanmakuDensityCurveProps> = ({ danmakuData, duration, bins: propBins }) => {
    const pathData = useMemo(() => {
        if (!duration) return '';

        // Use propBins if available, otherwise calculate from danmakuData
        let bins: number[];
        const binCount = propBins ? propBins.length : 100;

        if (propBins) {
            bins = propBins;
        } else if (danmakuData && danmakuData.length > 0) {
            bins = new Array(binCount).fill(0);
            const binWidth = duration / binCount;
            danmakuData.forEach(d => {
                const index = Math.floor(d.time / binWidth);
                if (index >= 0 && index < binCount) {
                    bins[index]++;
                }
            });
        } else {
            return '';
        }

        // 2. Smooth bins (moving average)
        const smoothed = new Array(binCount).fill(0);
        const windowSize = propBins ? 2 : 3; // Bit less smoothing for many bins
        for (let i = 0; i < binCount; i++) {
            let sum = 0;
            let count = 0;
            for (let j = i - windowSize; j <= i + windowSize; j++) {
                if (j >= 0 && j < binCount) {
                    sum += bins[j];
                    count++;
                }
            }
            smoothed[i] = sum / count;
        }

        // 3. Normalize
        const maxVal = Math.max(...smoothed) || 1;
        const normalized = smoothed.map(v => v / maxVal);

        // 4. Create SVG path (Area)
        let points = `0,100 `;
        normalized.forEach((v, i) => {
            const x = (i / (binCount - 1)) * 100;
            const y = 100 - (v * 80);
            points += `${x},${y} `;
        });
        points += `100,100`;

        return points;
    }, [danmakuData, duration, propBins]);

    if (!pathData) return null;

    return (
        <div className="absolute left-0 right-0 bottom-full h-8 pointer-events-none overflow-hidden opacity-50">
            <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="w-full h-full fill-[#FB7299]/30 stroke-[#FB7299]/50 stroke-[0.5]"
            >
                <polyline points={pathData} />
            </svg>
        </div>
    );
};

export default React.memo(DanmakuDensityCurve);
