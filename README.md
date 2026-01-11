# mikufans放映姬

还原直播观看体验，基于BililiveRecorder录制的原始文件.

## 使用

### 通过 GitHub Pages
无需安装和配置环境，直接使用
1. 打开 [mikufans放映姬](https://yaki1210.github.io/BililiveRecorder-Player/) .
2. 选取BililiveRecorder配置的工作目录
   - 注意：此程序完全在您的浏览器中运行，使用文件系统访问 API。不会上传任何数据

### 本地部署

**依赖:** Node.js

1. Install:
   ```bash
   npm install
   ```

2. Run:
   ```bash
   npm run dev
   ```

3. 在浏览器中打开 `http://localhost:3000`.

## Features
- **Local Playback**: Plays video files directly from your local disk.
- **Danmaku Support**: Automatically loads and displays danmaku (XML) files.
