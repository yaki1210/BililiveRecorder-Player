import React from 'react';
import { StreamSegment } from '../types';
import { formatSegmentTime } from '../utils/parser';

interface SegmentSelectorProps {
    segments: StreamSegment[];
    currentSegmentIndex: number;
    onSelect: (index: number) => void;
    isFullscreen: boolean;
}

const SegmentSelector: React.FC<SegmentSelectorProps> = ({ segments, currentSegmentIndex, onSelect, isFullscreen }) => {
    if (segments.length <= 1 || isFullscreen) return null;

    return (
        <div className="h-10 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 overflow-x-auto overflow-y-hidden whitespace-nowrap scrollbar-none shrink-0 transition-colors duration-300 w-full max-w-full">
            <style dangerouslySetInnerHTML={{ __html: `.scrollbar-none::-webkit-scrollbar { display: none; } .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }` }} />
            <span className="text-xs font-bold mr-3 text-gray-500 dark:text-gray-400 shrink-0">分P选集</span>
            {segments.map((seg, idx) => {
                const startTimeFormatted = formatSegmentTime(seg.file.timestamp);
                return (
                    <button
                        key={idx}
                        onClick={() => onSelect(idx)}
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
    );
};

export default SegmentSelector;
