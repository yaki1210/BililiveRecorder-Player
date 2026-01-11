import React, { useState } from 'react';
import { Upload, FolderOpen, Sun, Moon, Settings, X, Folder, RotateCw } from 'lucide-react';
import { StreamerProfile } from '../types';

interface HomeProps {
  onFilesSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDirectoryHandleSelected: () => void; // New prop for Directory API
  hasSavedDirectory: boolean;            // New prop showing if we can quick-load
  streamers: StreamerProfile[];
  onSelectStreamer: (s: StreamerProfile) => void;
  isLoading: boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const Home: React.FC<HomeProps> = ({
  onFilesSelected,
  onDirectoryHandleSelected,
  hasSavedDirectory,
  streamers,
  onSelectStreamer,
  isLoading,
  theme,
  toggleTheme,
  needsPermissionGrant
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const isFileSystemApiSupported = 'showDirectoryPicker' in window;

  return (
    <div className="min-h-screen bg-[#f1f2f3] dark:bg-[#0f0f0f] p-8 flex flex-col items-center transition-colors duration-300 relative">

      {/* Top Left: Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-6 left-6 p-2.5 rounded-full bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-[#FB7299] dark:hover:text-[#FB7299] transition-all z-20"
      >
        {theme === 'light' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      {/* Top Right: Settings */}
      <button
        onClick={() => setShowSettings(true)}
        className="absolute top-6 right-6 p-2.5 rounded-full bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-[#FB7299] dark:hover:text-[#FB7299] transition-all z-20"
      >
        <Settings className="w-5 h-5" />
      </button>

      {/* Main Content */}
      <div className="max-w-7xl w-full mt-12">
        <header className={`mb-12 text-center ${streamers.length > 0 ? 'mb-8' : ''}`}>
          <h1 className="text-4xl font-bold text-[#FB7299] mb-4 tracking-tight">mikufans放映姬</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8"></p>

          {streamers.length === 0 && (
            <div className="flex flex-col items-center gap-4">
              {isFileSystemApiSupported ? (
                <button
                  onClick={onDirectoryHandleSelected}
                  className={`flex items-center gap-3 px-8 py-4 rounded-xl shadow-sm border font-medium transition-all hover:shadow-md 
                        ${needsPermissionGrant
                      ? 'bg-[#FB7299] text-white border-[#FB7299] hover:bg-[#e46589]' // 强调色：点击继续
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-[#FB7299] hover:text-[#FB7299]'
                    }`}
                >
                  {isLoading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
                  ) : (
                    // 如果需要授权，显示刷新图标；否则显示文件夹图标
                    needsPermissionGrant ? <RotateCw className="w-6 h-6" /> : <FolderOpen className="w-6 h-6" />
                  )}

                  {/* 动态文案 */}
                  {needsPermissionGrant
                    ? "检测到上次的录播库，点击继续"
                    : "选择录播文件夹"}
                </button>
              ) : (
                /* 2. 降级使用 Input (不支持持久化) */
                <div className="relative group inline-block">
                  <input
                    type="file"
                    // @ts-ignore
                    webkitdirectory=""
                    directory=""
                    multiple
                    onChange={onFilesSelected}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <button className="flex items-center gap-3 bg-white dark:bg-gray-800 px-8 py-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-medium transition-all group-hover:shadow-md group-hover:border-[#FB7299] group-hover:text-[#FB7299]">
                    {isLoading ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#FB7299]"></div>
                    ) : (
                      <FolderOpen className="w-6 h-6" />
                    )}
                    选择录播文件夹
                  </button>
                  {/* 如果需要授权，提示用户 */}
                  {needsPermissionGrant && (
                    <p className="text-sm text-[#FB7299] animate-pulse">
                      浏览器为了安全，需要您点击确认以重新读取文件
                    </p>
                  )}
                </div>
              )}

              {/* <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">支持包含 .flv .xml .jpg 的文件夹结构</p> */}
            </div>
          )}
        </header>

        {/* ... (Streamer List Rendering - Unchanged) ... */}
        {streamers.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {streamers.map((streamer) => (
              <div
                key={streamer.roomId}
                onClick={() => onSelectStreamer(streamer)}
                className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer group flex flex-col border border-transparent hover:border-[#FB7299]/30"
              >
                {/* Simulated Cover */}
                <div className="aspect-video bg-gray-200 dark:bg-gray-700 relative overflow-hidden">
                  {streamer.sessions[0]?.segments[0]?.coverFile ? (
                    <img
                      src={URL.createObjectURL(streamer.sessions[0].segments[0].coverFile)}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      alt="cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <span className="text-3xl font-bold opacity-20">NO COVER</span>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="font-bold text-gray-800 dark:text-gray-100 text-lg line-clamp-1 group-hover:text-[#FB7299] transition-colors">
                      {streamer.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className="hover:text-[#23ade5] hover:underline" onClick={(e) => { e.stopPropagation(); window.open(`https://live.bilibili.com/${streamer.roomId}`, '_blank'); }}>
                      房间号: {streamer.roomId}
                    </span>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center text-xs text-gray-400">
                    <span>{streamer.sessions.length} 场录播</span>
                    <span>最新: {new Date(streamer.sessions[0]?.startTime).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#FB7299]" />
                设置
              </h2>
              <button onClick={() => setShowSettings(false)} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block">
                  工作文件夹 (录播源)
                </label>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700 flex items-start gap-3">
                  <Folder className="w-5 h-5 text-[#FB7299] shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 dark:text-gray-100 font-medium truncate">
                      {streamers.length > 0 ? `已加载 ${streamers.length} 个主播` : '未选择文件夹'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      {hasSavedDirectory ? "已保存上次路径 (点击重新选择可更改)" : "未保存路径"}
                    </div>
                  </div>
                </div>

                {/* Re-select button logic */}
                {isFileSystemApiSupported ? (
                  <button
                    onClick={() => { onDirectoryHandleSelected(); setShowSettings(false); }}
                    className="w-full py-2 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors shadow-sm"
                  >
                    更改工作文件夹...
                  </button>
                ) : (
                  <div className="relative group block w-full">
                    <input
                      type="file"
                      // @ts-ignore
                      webkitdirectory=""
                      directory=""
                      multiple
                      onChange={(e) => { onFilesSelected(e); setShowSettings(false); }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <button className="w-full py-2 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors shadow-sm">
                      更改工作文件夹...
                    </button>
                  </div>
                )}
              </div>
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                <p className="text-xs text-center text-gray-400">BiliRecorded Player v1.0</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;