# BiliRecorder Player

A high-fidelity web player for local BililiveRecorder files with automatic session grouping and danmaku support.

## Usage

### Using via GitHub Pages (Recommended)
You can use this player directly without installing anything by visiting the GitHub Pages deployment of this repository.

1. Open the [GitHub Pages URL](https://<your-username>.github.io/<repo-name>/) (replace with your actual URL).
2. Click "Select Folder" to choose the directory containing your recordings.
   - Note: This runs entirely in your browser using the File System Access API. No data is uploaded.

### Run Locally

If you prefer to run it locally or develop the code:

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the app:
   ```bash
   npm run dev
   ```

3. Open `http://localhost:3000` in your browser.

## Features
- **Local Playback**: Plays video files directly from your local disk.
- **Danmaku Support**: Automatically loads and displays danmaku (XML) files.
- **Session Grouping**: intelligent grouping of recording segments.
