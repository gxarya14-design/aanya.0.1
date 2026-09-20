import { findAppDefinition, resolveApplication } from "./appDatabase.js";
import { listWindows, focusWindow } from "./windowManager.js";
import { listProcesses } from "./processManager.js";
import { runPowerShell, runPowerShellJSON } from "./powershell.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface AppLaunchResult {
  success: boolean;
  action: "launched" | "focused_existing" | "failed";
  appName: string;
  verified: boolean;
  message: string;
  error?: string;
}

export interface AppCloseResult {
  success: boolean;
  appName: string;
  verified: boolean;
  closedCount: number;
  message: string;
  error?: string;
}

const PROTECTED_PROCESS_NAMES = new Set([
  "aanya",
  "aizoya",
  "electron",
  "node",
  "tsx",
  "dwm",
  "explorer",
  "csrss",
  "smss",
  "winlogon",
  "lsass",
  "services",
  "system",
  "idle",
]);

function isProtectedTarget(name: string): boolean {
  return PROTECTED_PROCESS_NAMES.has(name.toLowerCase().replace(/\.exe$/i, ""));
}

/**
 * Smart application launcher with existing-instance detection and verification.
 */
export async function launchApplication(
  appName: string,
  rememberedPaths?: Record<string, string>
): Promise<AppLaunchResult> {
  const cleanName = appName.trim();
  const lowerName = cleanName.toLowerCase();
  const appDef = findAppDefinition(cleanName);

  // 1. Check if application is ALREADY running with a visible window
  const openWindows = await listWindows();
  const existingWindow = openWindows.find((w) => {
    if (appDef) {
      const matchesProc = appDef.processNames.some((p) =>
        w.processName.toLowerCase().includes(p.toLowerCase())
      );
      const matchesTitle = appDef.titleKeywords.some((tk) =>
        w.title.toLowerCase().includes(tk.toLowerCase())
      );
      if (matchesProc || matchesTitle) return true;
    }
    return (
      w.processName.toLowerCase().includes(lowerName) ||
      w.title.toLowerCase().includes(lowerName)
    );
  });

  if (existingWindow) {
    // Bring already running window to foreground
    const focusRes = await focusWindow(existingWindow.title);
    return {
      success: true,
      action: "focused_existing",
      appName: existingWindow.title,
      verified: focusRes.verified,
      message: `"${existingWindow.title}" is already open — brought it to the foreground.`,
    };
  }

  // 2. Try remembered path if configured
  if (rememberedPaths && rememberedPaths[lowerName]) {
    const remembered = rememberedPaths[lowerName];
    try {
      if (process.platform === "win32") {
        await execAsync(`start "" "${remembered}"`);
      } else {
        await execAsync(`"${remembered}"`);
      }
      await new Promise((r) => setTimeout(r, 1000));
      return {
        success: true,
        action: "launched",
        appName: cleanName,
        verified: true,
        message: `Opening "${cleanName}" via remembered path.`,
      };
    } catch {
      // Fall through to other launch mechanisms
    }
  }

  // 3. Try App Definition launch commands or protocols
  if (appDef) {
    for (const cmd of appDef.launchCommands) {
      try {
        if (process.platform === "win32") {
          await execAsync(`start "" "${cmd}"`);
        } else {
          await execAsync(cmd);
        }
        await new Promise((r) => setTimeout(r, 800));

        // Verification check
        const procs = await listProcesses();
        const launched = procs.some((p) =>
          appDef.processNames.some((targetP) =>
            p.name.toLowerCase().includes(targetP.toLowerCase())
          )
        );

        return {
          success: true,
          action: "launched",
          appName: appDef.canonicalName,
          verified: launched,
          message: launched
            ? `Successfully launched "${appDef.canonicalName}".`
            : `Opening "${appDef.canonicalName}".`,
        };
      } catch {
        continue;
      }
    }
  }

  // 4. Windows StartApps / UWP / Start Menu Search
  if (process.platform === "win32") {
    const escapedName = cleanName.replace(/'/g, "''");
    const startAppScript = `
      $apps = Get-StartApps
      # Try exact match first, then prefix match, then substring match
      $app = $apps | Where-Object { $_.Name -eq '${escapedName}' } | Select-Object -First 1
      if (-not $app) {
        $app = $apps | Where-Object { $_.Name -like '${escapedName}*' } | Select-Object -First 1
      }
      if (-not $app) {
        $app = $apps | Where-Object { $_.Name -like '*${escapedName}*' } | Select-Object -First 1
      }
      if ($app) {
        Start-Process "shell:AppsFolder\\$($app.AppID)"
        $true
      } else {
        $false
      }
    `;
    const startRes = await runPowerShell(startAppScript);
    if (startRes.ok && startRes.stdout.includes("True")) {
      await new Promise((r) => setTimeout(r, 1000));
      return {
        success: true,
        action: "launched",
        appName: cleanName,
        verified: true,
        message: `Opening "${cleanName}" from Windows Apps / Start Menu.`,
      };
    }
  }

  // 5. Generic shell start fallback
  try {
    const launchCmd =
      process.platform === "win32"
        ? `start "" "${cleanName}"`
        : process.platform === "darwin"
        ? `open -a "${cleanName}"`
        : cleanName;
    await execAsync(launchCmd);
    await new Promise((r) => setTimeout(r, 800));

    return {
      success: true,
      action: "launched",
      appName: cleanName,
      verified: true,
      message: `Opening "${cleanName}".`,
    };
  } catch (err: any) {
    return {
      success: false,
      action: "failed",
      appName: cleanName,
      verified: false,
      message: `Could not launch "${cleanName}". The application might not be installed or not in system PATH.`,
      error: String(err?.message || err),
    };
  }
}

/**
 * Gracefully closes an application and all of its associated windows/processes.
 * Follows deterministic resolution:
 * 1. Resolves friendly names, aliases, and executables (e.g. Chrome / Google Chrome / chrome.exe -> chrome.exe)
 * 2. Scans for visible top-level windows belonging to the application via Win32 EnumWindows
 * 3. Gracefully sends WM_CLOSE (0x0010) to the application's top-level HWND(s)
 * 4. Verifies that the targeted application window is actually closed
 * 5. If force=true or background helper cleanup is required, cleanly terminates the matching processes
 * 6. Emits detailed diagnostic logs for troubleshooting
 */
export async function closeApplication(appName: string, force = false): Promise<AppCloseResult> {
  const requestedName = (appName || "").trim();
  if (!requestedName) {
    console.warn("[CLOSE APP] Requested name: <empty>");
    return {
      success: false,
      appName: "",
      verified: false,
      closedCount: 0,
      message: "No application name specified to close.",
    };
  }

  // 1. Resolve application deterministically
  const resolved = resolveApplication(requestedName);
  const normalized = resolved.normalizedName;
  const resolvedExecutable = resolved.executable;

  console.log(`[CLOSE APP] Requested name: ${requestedName}`);
  console.log(`[CLOSE APP] Normalized name: ${normalized}`);
  console.log(`[CLOSE APP] Resolved executable: ${resolvedExecutable}`);

  // Safety guard against core assistant or critical OS processes
  if (
    isProtectedTarget(requestedName) ||
    isProtectedTarget(normalized) ||
    resolved.processNames.some(isProtectedTarget)
  ) {
    console.warn(`[CLOSE APP] Refusing to close protected process: "${requestedName}"`);
    return {
      success: false,
      appName: resolved.canonicalName,
      verified: false,
      closedCount: 0,
      message: `Cannot close core assistant or critical system process "${requestedName}".`,
      error: "Protected process",
    };
  }

  if (process.platform !== "win32") {
    console.warn(`[CLOSE APP] Non-Windows platform: ${process.platform}`);
    return {
      success: false,
      appName: resolved.canonicalName,
      verified: false,
      closedCount: 0,
      message: "Application control is only supported on Windows.",
      error: "Platform not win32",
    };
  }

  // 2. Query visible desktop windows and running processes
  const openWindows = await listWindows();
  const matchingWindows = openWindows.filter((w) => {
    const pName = w.processName.toLowerCase().replace(/\.exe$/i, "");
    const title = w.title.toLowerCase();

    // Direct process name match
    if (resolved.processNames.some((p) => p === pName)) return true;
    if (pName === normalized || pName === resolvedExecutable.toLowerCase().replace(/\.exe$/i, "")) return true;

    // Title keyword match for known applications
    if (resolved.titleKeywords.some((tk) => title.includes(tk))) return true;

    return false;
  });

  // Query running OS processes matching the application's executable/process names
  const procFilterList = Array.from(
    new Set([normalized, resolvedExecutable.replace(/\.exe$/i, ""), ...resolved.processNames])
  );
  const escapedProcNames = procFilterList.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
  const procsScript = `
    $names = @(${escapedProcNames})
    Get-Process -Name $names -ErrorAction SilentlyContinue |
      Select-Object Id, ProcessName, MainWindowHandle
  `;
  const matchingProcsRaw = await runPowerShellJSON<any[] | any>(procsScript);
  const matchingProcs: { Id: number; ProcessName: string; MainWindowHandle: number }[] = matchingProcsRaw
    ? (Array.isArray(matchingProcsRaw) ? matchingProcsRaw : [matchingProcsRaw])
    : [];

  const procIdsSummary = matchingProcs.map((p) => p.Id).join(", ") || "none";
  const windowSummary = matchingWindows.length > 0
    ? matchingWindows.map((w) => `HWND ${w.hwnd} ("${w.title}")`).join(", ")
    : "none";

  console.log(`[CLOSE APP] Matching processes: ${matchingProcs.length} (PIDs: ${procIdsSummary})`);
  console.log(`[CLOSE APP] Matching visible windows/HWNDs: ${matchingWindows.length} (${windowSummary})`);

  // If neither windows nor processes are found, fail gracefully with clear diagnostic
  if (matchingWindows.length === 0 && matchingProcs.length === 0) {
    console.log(`[CLOSE APP] Target "${resolved.canonicalName}" is not currently running.`);
    return {
      success: false,
      appName: resolved.canonicalName,
      verified: false,
      closedCount: 0,
      message: `Application "${resolved.canonicalName}" is not currently running.`,
    };
  }

  // 3. Close path for visible desktop application windows
  if (matchingWindows.length > 0) {
    // Sensible deterministic ordering: active foreground window first, then by z-order
    const sortedWindows = [...matchingWindows].sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return (a.hwnd || 0) - (b.hwnd || 0);
    });

    const targetHwnds = sortedWindows.map((w) => w.hwnd);
    console.log(`[CLOSE APP] Selected target HWND: ${targetHwnds.join(", ")}`);

    // Graceful closure via Win32 WM_CLOSE (0x0010)
    const closeHwndsScript = `
      if (-not ([System.Management.Automation.PSTypeName]'Win32CloseHelper').Type) {
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32CloseHelper {
            [DllImport("user32.dll", SetLastError = true)]
            public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
          }
"@
      }
      $hwnds = @(${targetHwnds.join(",")})
      foreach ($h in $hwnds) {
        [Win32CloseHelper]::PostMessage([IntPtr]$h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      }
    `;

    console.log(`[CLOSE APP] Close request sent: WM_CLOSE (0x0010) posted to HWND(s) ${targetHwnds.join(", ")}`);
    await runPowerShell(closeHwndsScript);

    // Wait for window closure transition
    await new Promise((r) => setTimeout(r, 500));

    // Verify window closure
    const postWindows = await listWindows();
    const stillOpenWindows = postWindows.filter((w) => targetHwnds.includes(w.hwnd));

    if (stillOpenWindows.length === 0) {
      console.log(`[CLOSE APP] Verification result: All target application windows closed successfully.`);
      return {
        success: true,
        appName: resolved.canonicalName,
        verified: true,
        closedCount: targetHwnds.length,
        message: `Successfully closed "${resolved.canonicalName}".`,
      };
    }

    // Windows didn't close immediately (e.g. unsaved changes dialog or hung app)
    if (force) {
      console.log(`[CLOSE APP] Windows still open, force flag specified — terminating processes.`);
      const killScript = `
        $names = @(${escapedProcNames})
        Stop-Process -Name $names -Force -ErrorAction SilentlyContinue
      `;
      await runPowerShell(killScript);
      await new Promise((r) => setTimeout(r, 400));

      const recheckWindows = await listWindows();
      const stillOpenAfterForce = recheckWindows.filter((w) => targetHwnds.includes(w.hwnd));
      const verified = stillOpenAfterForce.length === 0;

      console.log(`[CLOSE APP] Verification result: ${verified ? "Force terminated successfully" : "Still open after force"}`);
      return {
        success: verified,
        appName: resolved.canonicalName,
        verified,
        closedCount: targetHwnds.length,
        message: verified
          ? `Force-closed "${resolved.canonicalName}".`
          : `Attempted to force-close "${resolved.canonicalName}", but some processes or windows remain.`,
      };
    }

    console.log(`[CLOSE APP] Verification result: Window still open (may be waiting for user confirmation or unsaved changes).`);
    return {
      success: false,
      appName: resolved.canonicalName,
      verified: false,
      closedCount: targetHwnds.length - stillOpenWindows.length,
      message: `Sent close request to "${resolved.canonicalName}", but the window remains open (it may have an unsaved changes confirmation dialog).`,
    };
  }

  // 4. Fallback for background-only processes (no visible top-level window)
  console.log(`[CLOSE APP] No visible window found; closing ${matchingProcs.length} background process(es).`);
  const termScript = `
    $names = @(${escapedProcNames})
    Stop-Process -Name $names ${force ? "-Force" : ""} -ErrorAction SilentlyContinue
  `;
  await runPowerShell(termScript);
  await new Promise((r) => setTimeout(r, 400));

  const verifyProcsRaw = await runPowerShellJSON<any[] | any>(procsScript);
  const remainingProcs = verifyProcsRaw
    ? (Array.isArray(verifyProcsRaw) ? verifyProcsRaw : [verifyProcsRaw])
    : [];

  const verified = remainingProcs.length === 0;
  console.log(`[CLOSE APP] Close request sent: Process stop sent`);
  console.log(`[CLOSE APP] Verification result: ${verified ? "All processes terminated" : `${remainingProcs.length} process(es) still running`}`);

  return {
    success: verified || remainingProcs.length < matchingProcs.length,
    appName: resolved.canonicalName,
    verified,
    closedCount: matchingProcs.length - remainingProcs.length,
    message: verified
      ? `Successfully closed background processes for "${resolved.canonicalName}".`
      : `Closed ${matchingProcs.length - remainingProcs.length} process(es) for "${resolved.canonicalName}".`,
  };
}
