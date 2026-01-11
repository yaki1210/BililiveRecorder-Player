export interface DanmakuItem {
  time: number; // Relative time in seconds
  type: number;
  size: number;
  color: number;
  timestamp: number; // Unix timestamp
  pool: number;
  uid: string;
  rowId: string;
  content: string;
  senderName?: string; 
  medalName?: string;
  medalLevel?: number;
  medalColorBorder?: string; // Hex color with alpha e.g. #3FB4F699
  trackIndex: number; // Calculated row index for anti-overlap
  emots?: Record<string, string>; // Map of code (e.g. [dog]) to Image URL
  stickerUrl?: string; // For large room stickers
}

export interface StreamFile {
  originalFile: File;
  name: string;
  roomId: string;
  streamerName: string;
  dateStr: string;
  timeStr: string;
  timestamp: number; // Parsed date object time
  title: string;
  ext: string;
}

export interface StreamSegment {
  file: StreamFile;
  duration?: number; // In seconds
  danmakuFile?: File;
  coverFile?: File;
  danmakuCount?: number;
}

// A continuous viewing session (logic: same title, gap < 60 mins)
export interface StreamSession {
  id: string; // Unique ID
  roomId: string;
  streamerName: string;
  title: string;
  startTime: number;
  endTime: number;
  segments: StreamSegment[];
  totalDuration: number; 
  totalDanmakuCount: number;
  coverUrl?: string;
}

export interface StreamerProfile {
  roomId: string;
  name: string;
  latestCoverUrl?: string;
  sessions: StreamSession[];
}

export type ViewState = 'HOME' | 'STREAMER' | 'PLAYER';