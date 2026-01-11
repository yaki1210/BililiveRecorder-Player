import React, { useState, useEffect, useCallback } from 'react'; // 引入 useCallback
import { get, set } from 'idb-keyval';
import Home from './components/Home';
import StreamerPage from './components/StreamerPage';
import Player from './components/Player';
import { StreamerProfile, StreamSession, ViewState } from './types';
import { processRecordingFiles, scanDirectoryHandle } from './utils/parser';

const App: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('HOME');
  const [isLoading, setIsLoading] = useState(false);

  // Theme State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Data State
  const [streamers, setStreamers] = useState<StreamerProfile[]>([]);
  const [selectedStreamer, setSelectedStreamer] = useState<StreamerProfile | null>(null);
  const [selectedSession, setSelectedSession] = useState<StreamSession | null>(null);

  // New State: 标记是否需要用户点击来恢复权限
  const [needsPermissionGrant, setNeedsPermissionGrant] = useState(false);

  // 核心加载逻辑：从 Handle 加载文件
  const loadFromHandle = async (handle: any) => {
    try {
      setIsLoading(true);
      // @ts-ignore
      const fileArray = await scanDirectoryHandle(handle);
      const groupedData = await processRecordingFiles(fileArray);
      setStreamers(groupedData);
      setNeedsPermissionGrant(false); // 加载成功，清除标记
    } catch (err) {
      console.error("Scanning Error", err);
      alert("读取文件夹内容失败");
    } finally {
      setIsLoading(false);
    }
  };

  // 初始化：尝试自动加载
  useEffect(() => {
    const initAutoLoad = async () => {
      try {
        const handle = await get('directoryHandle');
        if (handle) {
          // 检查权限状态
          // @ts-ignore
          const permission = await handle.queryPermission({ mode: 'read' });

          if (permission === 'granted') {
            // 权限已存在，直接加载！(达成无感自动加载)
            await loadFromHandle(handle);
          } else {
            // 权限需要重新授予 (浏览器安全限制，必须由用户点击触发)
            // 我们设置一个标记，通知 Home 组件显示“点击恢复”而不是“选择文件夹”
            setNeedsPermissionGrant(true);
          }
        }
      } catch (e) {
        console.warn("Auto-load failed", e);
      }
    };
    initAutoLoad();
  }, []);

  // 用户点击“选择文件夹”或“恢复权限”时的处理
  const handleDirectoryHandleSelected = async () => {
    try {
      let dirHandle = await get('directoryHandle');

      if (dirHandle) {
        // 尝试恢复权限
        // @ts-ignore
        const permission = await dirHandle.requestPermission({ mode: 'read' });
        if (permission === 'granted') {
          await loadFromHandle(dirHandle);
          return;
        }
      }

      // 如果没有旧句柄，或者权限被拒绝，则打开新选择器
      // @ts-ignore
      dirHandle = await window.showDirectoryPicker();
      await set('directoryHandle', dirHandle);
      await loadFromHandle(dirHandle);

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Directory API Error", err);
      }
    }
  };

  // Legacy Fallback (Input)
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsLoading(true);
      const fileArray = Array.from(e.target.files) as File[];
      setTimeout(async () => {
        try {
          const groupedData = await processRecordingFiles(fileArray);
          setStreamers(groupedData);
        } catch (err) { console.error(err); }
        finally { setIsLoading(false); }
      }, 100);
    }
  };

  // ... (Nav handlers unchanged) ...
  const handleSelectStreamer = (streamer: StreamerProfile) => {
    setSelectedStreamer(streamer);
    setViewState('STREAMER');
  };
  const handleSelectSession = (session: StreamSession) => {
    setSelectedSession(session);
    setViewState('PLAYER');
  };
  const handleBackToHome = () => {
    setSelectedStreamer(null);
    setViewState('HOME');
  };
  const handleBackToStreamer = () => {
    setSelectedSession(null);
    setViewState('STREAMER');
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
      {viewState === 'HOME' && (
        <Home
          onFilesSelected={handleFilesSelected}
          onDirectoryHandleSelected={handleDirectoryHandleSelected}
          // 将 needsPermissionGrant 传给 Home，控制 UI 显示
          needsPermissionGrant={needsPermissionGrant}
          streamers={streamers}
          onSelectStreamer={handleSelectStreamer}
          isLoading={isLoading}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      )}
      {/* ... others unchanged */}
      {viewState === 'STREAMER' && selectedStreamer && (
        <StreamerPage streamer={selectedStreamer} onBack={handleBackToHome} onSelectSession={handleSelectSession} />
      )}
      {viewState === 'PLAYER' && selectedSession && (
        <Player session={selectedSession} onBack={handleBackToStreamer} />
      )}
    </div>
  );
};

export default App;