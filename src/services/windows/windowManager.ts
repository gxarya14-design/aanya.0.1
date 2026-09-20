import { WindowInfo, WindowActionResult, WindowState } from "./types.js";
import { findAppDefinition } from "./appDatabase.js";
import { runPowerShell, runPowerShellJSON } from "./powershell.js";

const WINDOW_TITLE_DENYLIST = [
  "program manager",
  "task switching",
  "task view",
  "windows input experience",
  "system tray",
  "search",
  "start",
  "cortana",
  "microsoft text input application",
  "action center",
  "notification center",
  "network flyout",
  "battery flyout",
  "volume control",
];

export function isExcludedWindow(title: string | null | undefined): boolean {
  if (!title || !title.trim()) return true;
  const norm = title.trim().toLowerCase();
  if (
    norm === "aanya" ||
    norm.startsWith("aanya -") ||
    norm.startsWith("aanya ") ||
    norm.includes("aanya ai") ||
    norm.includes("aanya assistant") ||
    norm === "aizoya" ||
    norm.startsWith("aizoya -") ||
    norm.startsWith("aizoya ") ||
    norm.includes("aizoya ai") ||
    norm.includes("aizoya assistant")
  ) {
    return true;
  }
  return WINDOW_TITLE_DENYLIST.some((denied) => norm === denied || norm.startsWith(denied));
}

/**
 * Returns all active, visible top-level windows from the OS.
 * Filters out phantom/cloaked background processes (e.g. OBS in tray, background helpers)
 * using Win32 EnumWindows, DWM cloaked detection, and taskbar visibility criteria.
 */
export async function listWindows(): Promise<WindowInfo[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const script = `
    if (-not ([System.Management.Automation.PSTypeName]'Win32WindowFilter').Type) {
      Add-Type @"
        using System;
        using System.Collections.Generic;
        using System.Runtime.InteropServices;
        using System.Text;

        public class Win32WindowFilter {
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

          [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
          [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
          [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
          [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
          [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
          [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
          [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
          [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
          [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

          [StructLayout(LayoutKind.Sequential)]
          public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
          }

          public class WindowResult {
            public long hwnd;
            public string title;
            public string processName;
            public int processId;
            public string state;
            public bool isActive;
            public int zOrder;
          }

          public static List<WindowResult> GetDesktopWindows() {
            var results = new List<WindowResult>();
            IntPtr fg = GetForegroundWindow();
            IntPtr shellWnd = GetShellWindow();
            int order = 0;

            EnumWindows((hWnd, lParam) => {
              order++;
              if (hWnd == IntPtr.Zero || hWnd == shellWnd) return true;
              if (!IsWindowVisible(hWnd)) return true;

              int titleLen = GetWindowTextLength(hWnd);
              if (titleLen <= 0) return true;

              // 1. DWM Cloaked check (Windows 10/11)
              // Filters cloaked, suspended, virtual desktop, or tray-hidden windows like OBS
              int cloaked = 0;
              int hr = DwmGetWindowAttribute(hWnd, 14 /* DWMWA_CLOAKED */, out cloaked, sizeof(int));
              if (hr == 0 && cloaked != 0) return true;

              // 2. Extended styles & owner check (Windows Taskbar / Alt-Tab criteria)
              const int GWL_EXSTYLE = -20;
              const int WS_EX_TOOLWINDOW = 0x00000080;
              const int WS_EX_APPWINDOW = 0x00040000;
              const uint GW_OWNER = 4;

              int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
              bool isTool = (exStyle & WS_EX_TOOLWINDOW) != 0;
              bool isApp = (exStyle & WS_EX_APPWINDOW) != 0;
              IntPtr owner = GetWindow(hWnd, GW_OWNER);

              // Skip floating tool windows, overlays, or owned dialog helpers that aren't app windows
              if (isTool && !isApp) return true;
              if (owner != IntPtr.Zero && !isApp) return true;

              // 3. Window size & position check
              bool isMin = IsIconic(hWnd);
              RECT rect;
              GetWindowRect(hWnd, out rect);
              int width = rect.Right - rect.Left;
              int height = rect.Bottom - rect.Top;

              if (!isMin) {
                // If not minimized, window must have actual interactive dimensions
                if (width <= 0 || height <= 0) return true;
                // Offscreen coordinates for hidden background/tray windows (e.g. -32000, -32000)
                if (rect.Left <= -30000 && rect.Top <= -30000) return true;
              }

              // 4. Class name exclusions
              var sbClass = new StringBuilder(256);
              GetClassName(hWnd, sbClass, 256);
              string className = sbClass.ToString();
              if (className == "Progman" || className == "WorkerW" || 
                  className == "Shell_TrayWnd" || className == "Shell_SecondaryTrayWnd" ||
                  className == "EdgeUiInputTopWndClass" || className == "Dwm") {
                return true;
              }

              // 5. Window Title
              var sbTitle = new StringBuilder(titleLen + 2);
              GetWindowText(hWnd, sbTitle, sbTitle.Capacity);
              string title = sbTitle.ToString().Trim();
              if (string.IsNullOrEmpty(title)) return true;

              // 6. Process Name & Id
              uint pid = 0;
              GetWindowThreadProcessId(hWnd, out pid);
              string procName = "";
              try {
                var proc = System.Diagnostics.Process.GetProcessById((int)pid);
                procName = proc.ProcessName;
              } catch {
                procName = "unknown";
              }

              // Exclude background system hosts that are not user apps
              if (procName.Equals("SearchHost", StringComparison.OrdinalIgnoreCase) ||
                  procName.Equals("ShellExperienceHost", StringComparison.OrdinalIgnoreCase) ||
                  procName.Equals("StartMenuExperienceHost", StringComparison.OrdinalIgnoreCase) ||
                  procName.Equals("TextInputHost", StringComparison.OrdinalIgnoreCase) ||
                  procName.Equals("LockApp", StringComparison.OrdinalIgnoreCase)) {
                return true;
              }

              bool isMax = IsZoomed(hWnd);
              string state = isMin ? "minimized" : (isMax ? "maximized" : "normal");

              results.Add(new WindowResult {
                hwnd = hWnd.ToInt64(),
                title = title,
                processName = procName,
                processId = (int)pid,
                state = state,
                isActive = (hWnd == fg),
                zOrder = order
              });

              return true;
            }, IntPtr.Zero);

            return results;
          }
        }
"@
    }
    [Win32WindowFilter]::GetDesktopWindows()
  `;

  const raw = await runPowerShellJSON<any[] | any>(script);
  if (!raw) return [];

  const items = Array.isArray(raw) ? raw : [raw];
  const results: WindowInfo[] = [];

  for (const item of items) {
    const title = String(item.title || "").trim();
    if (isExcludedWindow(title)) continue;

    results.push({
      hwnd: Number(item.hwnd || 0),
      title,
      processName: String(item.processName || ""),
      processId: Number(item.processId || 0),
      state: (item.state as WindowState) || "normal",
      isActive: Boolean(item.isActive),
    });
  }

  return results;
}

export function isBackgroundCaptureWindow(win: WindowInfo): boolean {
  const proc = win.processName.toLowerCase();
  const title = win.title.toLowerCase();
  return (
    proc === "obs64" ||
    proc === "obs32" ||
    proc === "obs" ||
    title.includes("obs studio") ||
    title.startsWith("obs ")
  );
}

/**
 * Returns the currently active / foreground window.
 */
export async function getActiveWindowInfo(): Promise<WindowInfo | null> {
  const windows = await listWindows();
  if (windows.length === 0) return null;

  // Protect background capture / recording tools like OBS Studio from being wrongly
  // selected as the user's active/current window when another application exists.
  const userWindows = windows.filter((w) => !isBackgroundCaptureWindow(w));
  const candidateList = userWindows.length > 0 ? userWindows : windows;

  const active = candidateList.find((w) => w.isActive);
  if (active) return active;

  // If Aanya/Aizoya or desktop itself was foreground, return the topmost usable user window in Z-order
  return candidateList[0];
}

export function isActiveTargetPhrase(phrase: string): boolean {
  const norm = phrase.trim().toLowerCase();
  if (!norm) return true;

  const exactPhrases = [
    "active",
    "active window",
    "current",
    "current window",
    "this",
    "this window",
    "the window",
    "foreground",
    "foreground window",
    "focused",
    "focused window",
    "ise",
    "ise hi",
    "is window",
    "is window ko",
    "yeh",
    "ye",
    "ye window",
    "yeh window",
    "samne",
    "samne wali",
    "samne wala",
    "samne wali window",
    "jo samne hai",
    "abhi wali",
    "abhi wali window",
    "jo window abhi khuli hai",
    "khuli hui window",
    "main window",
  ];

  if (exactPhrases.includes(norm)) return true;

  // Regex heuristics
  if (/\b(active|current|focused|foreground)\b/.test(norm) && !/\b(chrome|code|notepad|calc|spotify|word|excel|edge|firefox|obs)\b/.test(norm)) {
    return true;
  }
  if (/^(is|yeh|ye)\s+(window|app)/.test(norm)) {
    return true;
  }
  if (norm.includes("abhi") && norm.includes("khuli")) {
    return true;
  }
  return false;
}

export function cleanTargetQuery(query: string): string {
  let cleaned = query.trim().toLowerCase();
  // Strip Hindi / Hinglish / English conversational fillers
  cleaned = cleaned
    .replace(/\b(ki\s+window|wali\s+window|ko\s+bhi|ko|ka|ke|pe|par|wali|wala|ki|khol\s+do|open\s+karo)\b/gi, " ")
    .replace(/\b(the\s+window\s+of|window\s+of|the\s+app\s+of|app\s+of)\b/gi, " ")
    .replace(/\b(window|application|app)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

/**
 * Resolves a natural-language target string to a specific window.
 * Uses smart multi-attribute scoring to ensure title tokens (e.g. "YouTube", "GitHub", "notes")
 * take precedence over active window bias when specific criteria are provided.
 */
export async function resolveTargetWindow(
  target?: string,
  prefetchedWindows?: WindowInfo[],
  preferredAction?: "minimize" | "maximize" | "restore" | "close" | "focus"
): Promise<{ window: WindowInfo | null; ambiguityCount: number; matchedBy: string }> {
  const windows = prefetchedWindows || (await listWindows());
  if (windows.length === 0) {
    return { window: null, ambiguityCount: 0, matchedBy: "none" };
  }

  const rawTarget = (target || "").trim();

  // 1. Active / current / this window check
  if (isActiveTargetPhrase(rawTarget)) {
    // Filter out background capture tools like OBS from active window selection
    const userWindows = windows.filter((w) => !isBackgroundCaptureWindow(w));
    const candidateList = userWindows.length > 0 ? userWindows : windows;
    const active = candidateList.find((w) => w.isActive) || candidateList[0];
    return { window: active || null, ambiguityCount: 1, matchedBy: "active" };
  }

  // Clean target of conversational particles (e.g. "YouTube wali Chrome window" -> "youtube chrome")
  const clean = cleanTargetQuery(rawTarget);
  const targetToMatch = clean.length > 0 ? clean : rawTarget.toLowerCase();

  // Extract query keywords (3+ letters, lowercased) for title token matching
  const queryTokens = targetToMatch
    .split(/[\s,._-]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3 && !["window", "application", "browser", "program"].includes(t));

  const appDef = findAppDefinition(targetToMatch) || findAppDefinition(rawTarget);

  interface ScoredWindow {
    window: WindowInfo;
    score: number;
    matchedBy: string;
  }

  const scored: ScoredWindow[] = [];

  for (const win of windows) {
    let score = 0;
    let matchType = "none";
    const titleLower = win.title.toLowerCase();
    const procLower = win.processName.toLowerCase();

    // 1. Title token matches (e.g. "youtube", "github", "todo", "server.ts")
    let tokenMatches = 0;
    for (const token of queryTokens) {
      if (titleLower.includes(token)) {
        tokenMatches++;
      }
    }
    if (tokenMatches > 0) {
      score += tokenMatches * 100;
      matchType = "titleTokens";
    }

    // 2. Substring match on whole targetToMatch in title
    if (titleLower.includes(targetToMatch)) {
      score += 200;
      matchType = "titleSubstring";
    }

    // 3. Exact process name or title match
    if (procLower === targetToMatch || titleLower === targetToMatch) {
      score += 150;
      matchType = "exactProcessOrTitle";
    } else if (procLower.includes(targetToMatch) || targetToMatch.includes(procLower)) {
      score += 60;
      if (matchType === "none") matchType = "processSubstring";
    }

    // 4. App Definition match
    if (appDef) {
      const matchesProc = appDef.processNames.some((p) => procLower.includes(p.toLowerCase()));
      const matchesTitle = appDef.titleKeywords.some((tk) => titleLower.includes(tk.toLowerCase()));
      if (matchesProc || matchesTitle) {
        score += 80;
        if (matchType === "none") matchType = `appDefinition:${appDef.canonicalName}`;
      }
    }

    // If there is ANY valid relevance, apply state and active preference
    if (score > 0) {
      // Active window gets a small boost (+25) so it breaks ties for same-app windows
      if (win.isActive) {
        score += 25;
      }

      // Action-specific state preference
      if (preferredAction === "restore") {
        if (win.state === "minimized") score += 15;
      } else {
        // For minimize, maximize, close, focus: prefer visible/normal windows over already-minimized ones
        if (win.state !== "minimized") score += 15;
      }

      scored.push({ window: win, score, matchedBy: matchType });
    }
  }

  if (scored.length === 0) {
    return { window: null, ambiguityCount: 0, matchedBy: "none" };
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const matchingCount = scored.filter((s) => s.score >= 50).length;

  return {
    window: best.window,
    ambiguityCount: matchingCount,
    matchedBy: best.matchedBy,
  };
}

/**
 * Verifies window state using Win32 API
 */
async function checkWindowState(hwnd: number): Promise<{ exists: boolean; isIconic: boolean; isZoomed: boolean; isForeground: boolean }> {
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32StateCheck {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
      }
"@
    $h = [IntPtr]${hwnd}
    [PSCustomObject]@{
      exists = [Win32StateCheck]::IsWindow($h)
      isIconic = [Win32StateCheck]::IsIconic($h)
      isZoomed = [Win32StateCheck]::IsZoomed($h)
      isForeground = ([Win32StateCheck]::GetForegroundWindow() -eq $h)
    }
  `;
  const res = await runPowerShellJSON<{ exists: boolean; isIconic: boolean; isZoomed: boolean; isForeground: boolean }>(script);
  return res || { exists: false, isIconic: false, isZoomed: false, isForeground: false };
}

/**
 * Minimizes a target window with verification.
 */
export async function minimizeWindow(target?: string): Promise<WindowActionResult> {
  const allWindows = await listWindows();
  const { window: targetWin, ambiguityCount } = await resolveTargetWindow(target, allWindows, "minimize");

  if (!targetWin) {
    return {
      success: false,
      action: "minimize",
      targetRequested: target,
      verified: false,
      message: target
        ? `No matching window found for "${target}" to minimize.`
        : "No open window found to minimize.",
    };
  }

  if (targetWin.state === "minimized") {
    return {
      success: true,
      action: "minimize",
      targetRequested: target,
      resolvedTitle: targetWin.title,
      resolvedProcessName: targetWin.processName,
      hwnd: targetWin.hwnd,
      verified: true,
      message: `"${targetWin.title}" is already minimized.`,
    };
  }

  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32Min {
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      }
"@
    [Win32Min]::ShowWindowAsync([IntPtr]${targetWin.hwnd}, 6) # SW_MINIMIZE
  `;

  await runPowerShell(script);
  await new Promise((r) => setTimeout(r, 200));

  // Verification step
  let state = await checkWindowState(targetWin.hwnd);
  let verified = state.isIconic;

  // Safe retry if needed
  if (!verified) {
    await runPowerShell(`
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32MinRetry {
          [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }
"@
        [Win32MinRetry]::ShowWindow([IntPtr]${targetWin.hwnd}, 6)
    `);
    await new Promise((r) => setTimeout(r, 200));
    state = await checkWindowState(targetWin.hwnd);
    verified = state.isIconic;
  }

  const ambigNote = ambiguityCount > 1 ? ` (targeted from ${ambiguityCount} matching windows)` : "";

  return {
    success: verified,
    action: "minimize",
    targetRequested: target,
    resolvedTitle: targetWin.title,
    resolvedProcessName: targetWin.processName,
    hwnd: targetWin.hwnd,
    verified,
    message: verified
      ? `Successfully minimized "${targetWin.title}"${ambigNote}.`
      : `Sent minimize command to "${targetWin.title}", but could not verify minimized state (window may be unresponsive).`,
  };
}

/**
 * Maximizes a target window with verification.
 */
export async function maximizeWindow(target?: string): Promise<WindowActionResult> {
  const allWindows = await listWindows();
  const { window: targetWin, ambiguityCount } = await resolveTargetWindow(target, allWindows, "maximize");

  if (!targetWin) {
    return {
      success: false,
      action: "maximize",
      targetRequested: target,
      verified: false,
      message: target
        ? `No matching window found for "${target}" to maximize.`
        : "No open window found to maximize.",
    };
  }

  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32Max {
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
      }
"@
    $h = [IntPtr]${targetWin.hwnd}
    [Win32Max]::ShowWindowAsync($h, 3) # SW_MAXIMIZE
    [Win32Max]::SetForegroundWindow($h)
  `;

  await runPowerShell(script);
  await new Promise((r) => setTimeout(r, 200));

  const state = await checkWindowState(targetWin.hwnd);
  const verified = state.isZoomed;
  const ambigNote = ambiguityCount > 1 ? ` (targeted from ${ambiguityCount} matching windows)` : "";

  return {
    success: verified,
    action: "maximize",
    targetRequested: target,
    resolvedTitle: targetWin.title,
    resolvedProcessName: targetWin.processName,
    hwnd: targetWin.hwnd,
    verified,
    message: verified
      ? `Successfully maximized "${targetWin.title}"${ambigNote}.`
      : `Sent maximize command to "${targetWin.title}", but could not verify maximized state (window may be fixed-size or unresponsive).`,
  };
}

/**
 * Restores a window to normal state with verification.
 */
export async function restoreWindow(target?: string): Promise<WindowActionResult> {
  const allWindows = await listWindows();
  const { window: targetWin, ambiguityCount } = await resolveTargetWindow(target, allWindows, "restore");

  if (!targetWin) {
    return {
      success: false,
      action: "restore",
      targetRequested: target,
      verified: false,
      message: target
        ? `No matching window found for "${target}" to restore.`
        : "No open window found to restore.",
    };
  }

  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32Restore {
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
      }
"@
    $h = [IntPtr]${targetWin.hwnd}
    [Win32Restore]::ShowWindowAsync($h, 9) # SW_RESTORE
    [Win32Restore]::SetForegroundWindow($h)
  `;

  await runPowerShell(script);
  await new Promise((r) => setTimeout(r, 200));

  const state = await checkWindowState(targetWin.hwnd);
  const verified = !state.isIconic && !state.isZoomed;
  const ambigNote = ambiguityCount > 1 ? ` (targeted from ${ambiguityCount} matching windows)` : "";

  return {
    success: verified,
    action: "restore",
    targetRequested: target,
    resolvedTitle: targetWin.title,
    resolvedProcessName: targetWin.processName,
    hwnd: targetWin.hwnd,
    verified,
    message: verified
      ? `Successfully restored "${targetWin.title}"${ambigNote}.`
      : `Sent restore command to "${targetWin.title}", but could not verify normal state.`,
  };
}

/**
 * Brings a target window to the foreground / focuses it.
 */
export async function focusWindow(target?: string): Promise<WindowActionResult> {
  const allWindows = await listWindows();
  const { window: targetWin, ambiguityCount } = await resolveTargetWindow(target, allWindows, "focus");

  if (!targetWin) {
    return {
      success: false,
      action: "focus",
      targetRequested: target,
      verified: false,
      message: target
        ? `No matching window found for "${target}" to focus.`
        : "No open window found to focus.",
    };
  }

  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32Focus {
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
      }
"@
    $h = [IntPtr]${targetWin.hwnd}
    [Win32Focus]::ShowWindowAsync($h, 9) # SW_RESTORE if minimized
    [Win32Focus]::SetForegroundWindow($h)
    [Win32Focus]::SwitchToThisWindow($h, $true)
  `;

  await runPowerShell(script);
  await new Promise((r) => setTimeout(r, 200));

  const state = await checkWindowState(targetWin.hwnd);
  const verified = state.isForeground;
  const ambigNote = ambiguityCount > 1 ? ` (targeted from ${ambiguityCount} matching windows)` : "";

  return {
    success: verified,
    action: "focus",
    targetRequested: target,
    resolvedTitle: targetWin.title,
    resolvedProcessName: targetWin.processName,
    hwnd: targetWin.hwnd,
    verified,
    message: verified
      ? `"${targetWin.title}" is now in the foreground${ambigNote}.`
      : `Sent focus command to "${targetWin.title}", but could not verify foreground activation.`,
  };
}

/**
 * Closes a specific window gracefully with verification.
 */
export async function closeWindow(target?: string): Promise<WindowActionResult> {
  const allWindows = await listWindows();
  const { window: targetWin, ambiguityCount } = await resolveTargetWindow(target, allWindows, "close");

  if (!targetWin) {
    return {
      success: false,
      action: "close",
      targetRequested: target,
      verified: false,
      message: target
        ? `No matching window found for "${target}" to close.`
        : "No open window found to close.",
    };
  }

  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32Close {
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
      }
"@
    $h = [IntPtr]${targetWin.hwnd}
    [Win32Close]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) # WM_CLOSE
  `;

  await runPowerShell(script);
  await new Promise((r) => setTimeout(r, 350));

  const state = await checkWindowState(targetWin.hwnd);
  const verified = !state.exists;
  const ambigNote = ambiguityCount > 1 ? ` (targeted from ${ambiguityCount} matching windows)` : "";

  return {
    success: verified,
    action: "close",
    targetRequested: target,
    resolvedTitle: targetWin.title,
    resolvedProcessName: targetWin.processName,
    hwnd: targetWin.hwnd,
    verified,
    message: verified
      ? `Successfully closed "${targetWin.title}"${ambigNote}.`
      : `Sent close request to "${targetWin.title}", but the window is still open (it might have an unsaved changes confirmation dialog).`,
  };
}

/**
 * Switches between open windows (Alt+Tab equivalent).
 */
export async function switchWindow(): Promise<WindowActionResult> {
  const windows = await listWindows();
  if (windows.length <= 1) {
    return {
      success: false,
      action: "switch",
      verified: false,
      message: "No other window is currently open to switch to.",
    };
  }

  // Find the next window that isn't currently active
  const targetWin = windows.find((w) => !w.isActive) || windows[0];
  return focusWindow(targetWin.title);
}
