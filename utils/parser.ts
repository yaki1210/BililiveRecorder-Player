import { StreamFile, StreamSession, StreamerProfile, StreamSegment, DanmakuItem } from '../types';

// Regex for: 录制-27183290-20260111-150905-121-瓦神话五排妹车.flv
const FILENAME_REGEX = /录制-(\d+)-(\d{8})-(\d{6})-(\d+)(?:-(.+))?\.(\w+)$/;

export const parseFileName = (file: File): StreamFile | null => {
  const match = file.name.match(FILENAME_REGEX);
  if (!match) return null;

  const [_, roomId, dateStr, timeStr, msStr, titlePart, ext] = match;

  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  const hour = parseInt(timeStr.substring(0, 2));
  const minute = parseInt(timeStr.substring(2, 4));
  const second = parseInt(timeStr.substring(4, 6));

  const date = new Date(year, month, day, hour, minute, second);

  let streamerName = "Unknown";
  // 尝试从 path 获取主播名，兼容 webkitRelativePath 和 File System Access API
  const path = (file as any).path || file.webkitRelativePath || "";
  const pathParts = path.split(/[/\\]/);

  if (pathParts.length > 1) {
    const parentFolder = pathParts[pathParts.length - 2];
    const folderMatch = parentFolder.match(/^(\d+)-(.*)$/);
    if (folderMatch) {
      streamerName = folderMatch[2];
    }
  }

  return {
    originalFile: file,
    name: file.name,
    roomId,
    streamerName,
    dateStr,
    timeStr,
    timestamp: date.getTime(),
    title: titlePart || "无标题",
    ext: ext.toLowerCase(),
  };
};

// Fast scan of XML to get duration and count without full DOM parse
const scanXmlMetadata = async (file: File): Promise<{ count: number, duration: number }> => {
  const text = await file.text();
  const pRegex = / p="([\d.]+),/g;
  let count = 0;
  let maxTime = 0;
  let match;
  while ((match = pRegex.exec(text)) !== null) {
    count++;
    const t = parseFloat(match[1]);
    if (t > maxTime) maxTime = t;
  }
  return { count, duration: maxTime };
};

// 新增：递归扫描 DirectoryHandle
export const scanDirectoryHandle = async (dirHandle: any): Promise<File[]> => {
  const files: File[] = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      // 手动补全 path 属性以便后续解析文件夹名
      Object.defineProperty(file, 'path', { value: `${dirHandle.name}/${file.name}`, writable: true });
      files.push(file);
    } else if (entry.kind === 'directory') {
      const subFiles = await scanDirectoryHandle(entry);
      // 修正子文件的路径，加上当前目录名
      subFiles.forEach((f: any) => {
        const currentPath = f.path || f.webkitRelativePath || f.name;
        Object.defineProperty(f, 'path', { value: `${dirHandle.name}/${currentPath}`, writable: true });
      });
      files.push(...subFiles);
    }
  }
  return files;
};

export const processRecordingFiles = async (files: File[]): Promise<StreamerProfile[]> => {
  const parsedFiles: StreamFile[] = [];
  const resourceMap: Record<string, File> = {};

  // 1. First pass: Identify files
  files.forEach(f => {
    const parsed = parseFileName(f);
    if (parsed) {
      if (['flv', 'mp4', 'mkv', 'ts'].includes(parsed.ext)) {
        parsedFiles.push(parsed);
      }
    }
    const baseName = f.name.substring(0, f.name.lastIndexOf('.'));
    if (f.name.endsWith('.xml') || f.name.endsWith('.jpg') || f.name.endsWith('.png')) {
      const ext = f.name.split('.').pop()?.toLowerCase();
      resourceMap[`${baseName}.${ext}`] = f;
    }
  });

  parsedFiles.sort((a, b) => a.timestamp - b.timestamp);

  const streamers: Record<string, StreamerProfile> = {};

  // 2. Group into sessions structure
  for (const pf of parsedFiles) {
    if (!streamers[pf.roomId]) {
      streamers[pf.roomId] = {
        roomId: pf.roomId,
        name: pf.streamerName,
        sessions: [],
      };
    }
  }

  // 3. Build sessions and scan metadata
  for (const streamer of Object.values(streamers)) {
    const streamerFiles = parsedFiles.filter(f => f.roomId === streamer.roomId);
    if (streamerFiles.length === 0) continue;

    let currentSession: StreamSession | null = null;

    for (const file of streamerFiles) {
      const isNewSession = !currentSession ||
        (file.title !== currentSession.title) ||
        (file.timestamp - currentSession.endTime > 60 * 60 * 1000);

      const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
      const coverKey = Object.keys(resourceMap).find(k => k.startsWith(baseName) && (k.endsWith('.jpg') || k.endsWith('.png')));
      const xmlKey = Object.keys(resourceMap).find(k => k.startsWith(baseName) && k.endsWith('.xml'));

      let duration = 0;
      let count = 0;
      if (xmlKey && resourceMap[xmlKey]) {
        try {
          const meta = await scanXmlMetadata(resourceMap[xmlKey]);
          duration = meta.duration;
          count = meta.count;
        } catch (e) {
          console.warn("Failed to scan XML metadata", xmlKey);
        }
      }

      const segment: StreamSegment = {
        file,
        duration,
        coverFile: coverKey ? resourceMap[coverKey] : undefined,
        danmakuFile: xmlKey ? resourceMap[xmlKey] : undefined,
        danmakuCount: count
      };

      if (isNewSession) {
        if (currentSession) streamer.sessions.push(currentSession);
        currentSession = {
          id: `${file.roomId}-${file.timestamp}`,
          roomId: file.roomId,
          streamerName: file.streamerName,
          title: file.title,
          startTime: file.timestamp,
          endTime: file.timestamp,
          segments: [segment],
          totalDuration: duration,
          totalDanmakuCount: count,
        };
      } else {
        if (currentSession) {
          currentSession.segments.push(segment);
          currentSession.endTime = file.timestamp;
          currentSession.totalDuration += duration;
          currentSession.totalDanmakuCount += count;
        }
      }
    }

    if (currentSession) streamer.sessions.push(currentSession);
    streamer.sessions.sort((a, b) => b.startTime - a.startTime);
  }

  return Object.values(streamers);
};

export const parseDanmakuXml = async (file: File): Promise<DanmakuItem[]> => {
  const text = await file.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "text/xml");
  const dElements = xmlDoc.getElementsByTagName("d");

  const rawItems: DanmakuItem[] = [];

  for (let i = 0; i < dElements.length; i++) {
    const d = dElements[i];
    const pAttr = d.getAttribute("p");
    const rawAttr = d.getAttribute("raw");
    const userAttr = d.getAttribute("user");
    const content = d.textContent || "";

    let senderName = userAttr || "Unknown";
    let medalName: string | undefined;
    let medalLevel: number | undefined;
    let medalColorBorder: string | undefined;
    let emots: Record<string, string> = {};
    let stickerUrl: string | undefined;

    if (rawAttr) {
      try {
        const parsedRaw = JSON.parse(rawAttr);
        let info = parsedRaw;
        const isPacket = (arr: any) => Array.isArray(arr) && arr.length >= 2 && Array.isArray(arr[0]) && typeof arr[1] === 'string';

        if (isPacket(parsedRaw)) {
          info = parsedRaw;
        } else if (Array.isArray(parsedRaw) && parsedRaw.length > 0 && isPacket(parsedRaw[0])) {
          info = parsedRaw[0];
        }

        if (Array.isArray(info)) {
          // Identify metadata array. In standard packet, it's info[0]. 
          // If info itself is metadata (legacy/fallback), use info.
          const meta = (info.length > 0 && Array.isArray(info[0])) ? info[0] : info;

          if (Array.isArray(info[2]) && info[2].length > 1) senderName = info[2][1];

          let basicMedalColor = 0;
          if (Array.isArray(info[3]) && info[3].length >= 2) {
            medalLevel = info[3][0];
            medalName = info[3][1];
            if (info[3].length >= 5) basicMedalColor = info[3][4];
          }

          // Room Sticker (in metadata index 13)
          if (meta[13] && typeof meta[13] === 'object' && meta[13].url) {
            let url = meta[13].url;
            // 强制转换为 HTTPS，处理 "http://" 和 "//" 开头的情况
            if (url.startsWith('http://')) url = url.replace('http://', 'https://');
            else if (url.startsWith('//')) url = `https:${url}`;

            stickerUrl = url;
          }

          // Extra Data (in metadata index 15)
          const extraData = meta[15];
          let foundColor = false;

          if (extraData && typeof extraData === 'object') {
            if (extraData.user?.medal?.v2_medal_color_border) {
              medalColorBorder = extraData.user.medal.v2_medal_color_border;
              foundColor = true;
            } else if (extraData.medal?.v2_medal_color_border) {
              medalColorBorder = extraData.medal.v2_medal_color_border;
              foundColor = true;
            }

            if (extraData.extra && typeof extraData.extra === 'string') {
              try {
                const extraJson = JSON.parse(extraData.extra);
                if (!foundColor) {
                  if (extraJson.medal?.v2_medal_color_border) {
                    medalColorBorder = extraJson.medal.v2_medal_color_border;
                    foundColor = true;
                  } else if (extraJson.user?.medal?.v2_medal_color_border) {
                    medalColorBorder = extraJson.user.medal.v2_medal_color_border;
                    foundColor = true;
                  }
                }
                if (extraJson.emots) {
                  Object.entries(extraJson.emots).forEach(([key, val]: [string, any]) => {
                    if (val && val.url) {
                      let url = val.url;
                      // 同样强制 HTTPS
                      if (url.startsWith('http://')) url = url.replace('http://', 'https://');
                      else if (url.startsWith('//')) url = `https:${url}`;

                      emots[key] = url;
                    }
                  });
                }
              } catch (e) { }
            }
          }

          if (!medalColorBorder && basicMedalColor) {
            medalColorBorder = `#${basicMedalColor.toString(16).padStart(6, '0')}`;
          }
        }
      } catch (e) { }
    }

    if (pAttr) {
      const parts = pAttr.split(',');
      const time = parseFloat(parts[0]);
      const mode = parseInt(parts[1]);
      const size = parseInt(parts[2]);
      const color = parseInt(parts[3]);
      const timestamp = parseInt(parts[4]);
      const uid = parts[6];

      rawItems.push({
        time,
        type: mode,
        size,
        color,
        timestamp,
        pool: parseInt(parts[5]),
        uid,
        rowId: parts[7],
        content,
        senderName,
        medalName,
        medalLevel,
        medalColorBorder,
        trackIndex: 0,
        emots: Object.keys(emots).length > 0 ? emots : undefined,
        stickerUrl
      });
    }
  }

  rawItems.sort((a, b) => a.time - b.time);

  // Track calculation logic (unchanged)
  const TOTAL_TRACKS = 16;
  const tracksFreeTime = new Array(TOTAL_TRACKS).fill(0);
  rawItems.forEach(item => {
    let bestTrack = -1;
    for (let t = 0; t < TOTAL_TRACKS; t++) {
      if (tracksFreeTime[t] <= item.time) {
        bestTrack = t;
        break;
      }
    }
    if (bestTrack === -1) {
      let minTime = Infinity;
      for (let t = 0; t < TOTAL_TRACKS; t++) {
        if (tracksFreeTime[t] < minTime) { minTime = tracksFreeTime[t]; bestTrack = t; }
      }
    }
    if (bestTrack === -1) bestTrack = item.timestamp % TOTAL_TRACKS;
    item.trackIndex = bestTrack;
    tracksFreeTime[bestTrack] = item.time + 3.0;
  });

  return rawItems;
};

// ... exports for format functions (unchanged) ...
export const formatDateFriendly = (ts: number): string => {
  // ... same as before
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (targetDate.getTime() === today.getTime()) return "今天";
  if (targetDate.getTime() === yesterday.getTime()) return "昨天";

  const weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return weekDays[date.getDay()];
  }

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

export const formatSegmentTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}.${d.getDate()}.${d.getHours()}.${d.getMinutes()}`;
}

export const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
};