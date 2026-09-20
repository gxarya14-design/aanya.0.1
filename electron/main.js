import { app, BrowserWindow, desktopCapturer, ipcMain, shell, screen, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// FIX (CreateForMonitor failed with hr: -2147024891 / 0x80070005 E_ACCESSDENIED):
// Modern Chromium (in Electron 43+) defaults to Windows.Graphics.Capture (WGC)
// for desktop capture. On Windows, WGC's CreateForMonitor fails with E_ACCESSDENIED
// due to Chromium process isolation / security boundaries. Disabling these flags
// forces WebRTC to use DXGI Desktop Duplication, which reliably captures full monitor frames.
app.commandLine.appendSwitch('disable-features', 'WebRtcAllowWgcDesktopCapturer,WebRtcAllowWgcScreenCapturer');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    // FIX (window-identification bug): index.html previously had
    // <title>My Google AI Studio App</title> (a scaffolding leftover), so
    // Aanya's own window never actually had "aanya" in its title despite
    // every focusTargetWindow() exclusion check in server.ts assuming it
    // would. This `title` option is only what shows before the page loads
    // — once index.html's <title> tag is read, Electron's
    // 'page-title-updated' event fires and the PAGE's title wins on the
    // native window, not this one. The real, lasting fix is index.html's
    // own <title> tag now also saying "Aanya" (see index.html) — that's
    // what nut-js's getWindows()/getActiveWindow() actually reports.
    // Keeping this option too just avoids a flash of "Aanya" -> "Electron"
    // -> "Aanya" while the page is still loading.
    title: 'Aanya',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });

  if (!app.isPackaged) {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

ipcMain.handle('get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      fetchWindowIcons: true,
      thumbnailSize: {
        width: 1280,
        height: 720,
      },
    });

    // Ensure full screen displays are ordered before individual windows
    sources.sort((a, b) => {
      const aIsScreen = a.id.startsWith('screen:');
      const bIsScreen = b.id.startsWith('screen:');
      if (aIsScreen && !bIsScreen) return -1;
      if (!aIsScreen && bIsScreen) return 1;
      return 0;
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      appIcon: source.appIcon ?? null,
      display_id: source.display_id ?? null,
    }));
  } catch (error) {
    console.error('[ElectronMain] getScreenSources failed:', error);
    return [];
  }
});

// FIX (clicks/scroll landing in the wrong place — see the import comment
// above for the full root cause): gives the renderer the REAL primary
// display resolution, straight from the OS via Electron's screen module.
// FIX (clicks/scroll landing in the wrong place with Windows DPI scaling):
// Electron's primaryDisplay.size is in DIP (Device-Independent Pixels),
// NOT physical hardware pixels. Nut.js and the Windows OS cursor APIs operate
// in physical pixels. When Windows display scaling is active (e.g. 125%, 150%, 200%),
// using display.size without scaleFactor causes mouse coordinates to be compressed
// into the top-left area. We compute the true physical pixel dimensions using
// scaleFactor and screen.dipToScreenRect, matching the OS cursor coordinates.
ipcMain.handle('get-real-screen-size', (_event, displayId) => {
  try {
    let targetDisplay = null;
    if (displayId) {
      const allDisplays = screen.getAllDisplays();
      targetDisplay = allDisplays.find((d) => String(d.id) === String(displayId));
    }
    if (!targetDisplay) {
      targetDisplay = screen.getPrimaryDisplay();
    }
    const scaleFactor = targetDisplay.scaleFactor || 1;
    let width = Math.round(targetDisplay.size.width * scaleFactor);
    let height = Math.round(targetDisplay.size.height * scaleFactor);

    if (typeof screen.dipToScreenRect === 'function' && targetDisplay.bounds) {
      try {
        const physicalRect = screen.dipToScreenRect(null, targetDisplay.bounds);
        if (physicalRect && physicalRect.width > 0 && physicalRect.height > 0) {
          width = Math.round(physicalRect.width);
          height = Math.round(physicalRect.height);
        }
      } catch (dipErr) {
        console.warn('[ElectronMain] dipToScreenRect fallback:', dipErr);
      }
    }

    console.log(`[ElectronMain] getRealScreenSize: physical=${width}x${height}, DIP=${targetDisplay.size.width}x${targetDisplay.size.height}, scaleFactor=${scaleFactor}`);
    return {
      width,
      height,
      scaleFactor,
      dipWidth: targetDisplay.size.width,
      dipHeight: targetDisplay.size.height,
    };
  } catch (error) {
    console.error('[ElectronMain] getRealScreenSize failed:', error);
    return null;
  }
});

// FIX (browser window not visibly appearing): server.ts used to shell out
// to "start <url>" from its own separate Node process, which could open a
// browser window somewhere the user never saw (a different desktop/session
// context, or minimized behind the Electron window) or silently fail.
// shell.openExternal runs inside Electron's own main process and is the
// OS-native, guaranteed-visible way to open a URL — so the renderer (App.tsx)
// now asks for this via IPC instead, after server.ts tells it (over the
// existing WebSocket) which URL to open.
//
// Revalidated here (not just trusting the caller) since any renderer script
// could otherwise invoke this to launch arbitrary protocol handlers.
ipcMain.handle('open-external-url', async (_event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn(`[ElectronMain] Refused to open non-http(s) URL: ${url}`);
      return { ok: false, error: 'Only http/https URLs are allowed.' };
    }

    await shell.openExternal(url);
    console.log(`[ElectronMain] Opened external URL: ${url}`);
    return { ok: true };
  } catch (error) {
    console.error('[ElectronMain] openExternalUrl failed:', error);
    return { ok: false, error: String(error?.message || error) };
  }
});

// FEATURE (open existing files on the PC, e.g. by voice — "open my
// resume", "open that photo"): mirrors open-external-url above exactly,
// but for local files. shell.openPath opens a file with the OS's default
// associated app — literally the same effect as the user double-clicking
// it themselves in File Explorer. Validates the path actually exists and
// is a file (not a folder) before attempting, same spirit as the protocol
// check on open-external-url — fail with a clear reason instead of a
// silent no-op or a confusing OS-level error surfacing later.
ipcMain.handle('open-file-path', async (_event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false, error: 'No file path was given.' };
    }

    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats) {
      console.warn(`[ElectronMain] Refused to open — path does not exist: ${filePath}`);
      return { ok: false, error: 'That file does not exist.' };
    }
    if (!stats.isFile()) {
      console.warn(`[ElectronMain] Refused to open — path is not a file: ${filePath}`);
      return { ok: false, error: 'That path is a folder, not a file.' };
    }

    // shell.openPath resolves to an error STRING on failure (e.g. "no
    // associated application"), and an empty string on success -- unlike
    // shell.openExternal, it does not throw for this kind of failure.
    const result = await shell.openPath(filePath);
    if (result) {
      console.error(`[ElectronMain] openPath failed for ${filePath}:`, result);
      return { ok: false, error: result };
    }

    console.log(`[ElectronMain] Opened file: ${filePath}`);
    return { ok: true };
  } catch (error) {
    console.error('[ElectronMain] openFilePath failed:', error);
    return { ok: false, error: String(error?.message || error) };
  }
});

// The renderer never receives arbitrary filesystem paths directly.  The
// native picker is kept in the main process and only returns a user-selected
// file, which is then read by the renderer for the current chat turn.
ipcMain.handle('select-chat-attachment', async (event) => {
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Attach a file to Aanya',
      properties: ['openFile'],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return { error: 'Please select a file.' };

    // FEATURE (large video uploads, 500MB-1GB+): reading the whole file
    // into memory and base64-encoding it for the small-attachment path
    // (below) does not scale past a few tens of MB. A video, up to the
    // server's chunked-upload cap, is instead handed back as a bare
    // filePath -- the renderer calls uploadLargeVideo, which streams it to
    // the server in 8MB chunks straight from disk, never holding the whole
    // file in memory at once.
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const maxVideoBytes = 2 * 1024 * 1024 * 1024;
    const videoMimeByExtension = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
    if (videoMimeByExtension[extension]) {
      if (stats.size > maxVideoBytes) return { error: 'Videos must be 2 GB or smaller.' };
      return {
        name: path.basename(filePath),
        size: stats.size,
        mimeType: videoMimeByExtension[extension],
        filePath,
        isLargeVideo: true,
      };
    }

    const maxBytes = 25 * 1024 * 1024;
    if (stats.size > maxBytes) {
      return { error: 'Files must be 25 MB or smaller.' };
    }
    const data = await fs.readFile(filePath);
    return {
      name: path.basename(filePath),
      size: stats.size,
      // The server determines supported handling from content/type safely;
      // Electron deliberately does not infer an executable MIME type here.
      mimeType: 'application/octet-stream',
      data: data.toString('base64'),
    };
  } catch (error) {
    console.error('[ElectronMain] selectChatAttachment failed:', error);
    return null;
  }
});

app.whenReady().then(() => {
  createWindow();
});

// FEATURE (large video uploads, 500MB-1GB+): does the entire chunked-upload
// loop here in the main process, reading fixed-size slices straight from
// disk via a file handle. Nothing about the video ever crosses the
// Electron IPC boundary as base64 -- only small JSON status/progress
// messages do. Server-side endpoints already existed
// (/api/video-uploads/...); this is the first real caller of them.
const VIDEO_CHUNK_BYTES = 8 * 1024 * 1024;
const SERVER_BASE_URL = 'http://localhost:3000';

ipcMain.handle('upload-large-video', async (event, { filePath, name, mimeType, size }) => {
  let fileHandle;
  try {
    const totalChunks = Math.ceil(size / VIDEO_CHUNK_BYTES);
    const createRes = await fetch(`${SERVER_BASE_URL}/api/video-uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: name, mimeType, size, totalChunks }),
    });
    if (!createRes.ok) {
      const body = await createRes.json().catch(() => ({}));
      throw new Error(body.error || `Could not start the upload (HTTP ${createRes.status}).`);
    }
    const { id } = await createRes.json();

    fileHandle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(VIDEO_CHUNK_BYTES);
    for (let index = 0; index < totalChunks; index++) {
      const position = index * VIDEO_CHUNK_BYTES;
      const { bytesRead } = await fileHandle.read(buffer, 0, VIDEO_CHUNK_BYTES, position);
      const chunk = buffer.subarray(0, bytesRead);
      const chunkRes = await fetch(`${SERVER_BASE_URL}/api/video-uploads/${id}/chunks/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(chunk.length) },
        body: chunk,
        duplex: 'half',
      });
      if (!chunkRes.ok) {
        const body = await chunkRes.json().catch(() => ({}));
        throw new Error(body.error || `Chunk ${index + 1}/${totalChunks} failed to upload.`);
      }
      event.sender.send('video-upload-progress', { id, progress: Math.round(((index + 1) / totalChunks) * 100) });
    }

    const completeRes = await fetch(`${SERVER_BASE_URL}/api/video-uploads/${id}/complete`, { method: 'POST' });
    if (!completeRes.ok) {
      const body = await completeRes.json().catch(() => ({}));
      throw new Error(body.error || 'Could not finalize the upload.');
    }
    return { id, name, mimeType, size };
  } catch (error) {
    console.error('[ElectronMain] uploadLargeVideo failed:', error);
    return { error: error?.message || 'Video upload failed.' };
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});