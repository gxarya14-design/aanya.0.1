import { ProcessInfo, ProcessActionResult } from "./types.js";
import { findAppDefinition, resolveApplication } from "./appDatabase.js";
import { runPowerShell, runPowerShellJSON } from "./powershell.js";

/**
 * Lists currently running processes that have either a main window or match user software.
 */
export async function listProcesses(filter?: string): Promise<ProcessInfo[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const cleanFilter = filter ? filter.trim().toLowerCase().replace(/\.exe$/i, "") : "";
  const script = cleanFilter
    ? `
      Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -like "*${cleanFilter.replace(/'/g, "''")}*" -or $_.MainWindowTitle -like "*${cleanFilter.replace(/'/g, "''")}*" } |
        Select-Object Id, ProcessName, MainWindowTitle,
          @{Name='MemoryMB'; Expression={[math]::Round($_.WorkingSet64 / 1MB, 1)}},
          Responding | Sort-Object MemoryMB -Descending
    `
    : `
      Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -or $_.WorkingSet64 -gt 25MB } |
        Select-Object Id, ProcessName, MainWindowTitle,
          @{Name='MemoryMB'; Expression={[math]::Round($_.WorkingSet64 / 1MB, 1)}},
          Responding | Sort-Object MemoryMB -Descending
    `;

  const raw = await runPowerShellJSON<any[] | any>(script);
  if (!raw) return [];

  const items = Array.isArray(raw) ? raw : [raw];
  let results: ProcessInfo[] = items.map((item) => ({
    id: Number(item.Id || 0),
    name: String(item.ProcessName || ""),
    title: item.MainWindowTitle ? String(item.MainWindowTitle) : undefined,
    memoryMB: Number(item.MemoryMB || 0),
    responding: Boolean(item.Responding),
  }));

  if (cleanFilter) {
    results = results.filter(
      (p) =>
        p.name.toLowerCase().includes(cleanFilter) ||
        (p.title && p.title.toLowerCase().includes(cleanFilter))
    );
  }

  return results;
}

/**
 * Finds a running process by name, PID, or friendly application alias.
 */
export async function findProcess(target: string): Promise<ProcessInfo | null> {
  const clean = target.trim().toLowerCase();
  const procs = await listProcesses(clean);

  // If numeric, check PID
  const pid = parseInt(clean, 10);
  if (!isNaN(pid) && String(pid) === clean) {
    const byPid = procs.find((p) => p.id === pid);
    if (byPid) return byPid;
  }

  // Check resolved application
  const resolved = resolveApplication(clean);
  for (const pName of resolved.processNames) {
    const match = procs.find((p) => p.name.toLowerCase() === pName.toLowerCase());
    if (match) return match;
  }

  // Check exact process name
  const exact = procs.find(
    (p) =>
      p.name.toLowerCase() === clean ||
      p.name.toLowerCase() === clean.replace(/\.exe$/i, "")
  );
  if (exact) return exact;

  // Check substring in process name or window title
  const sub = procs.find(
    (p) =>
      p.name.toLowerCase().includes(clean.replace(/\.exe$/i, "")) ||
      (p.title && p.title.toLowerCase().includes(clean))
  );
  if (sub) return sub;

  return null;
}

/**
 * Closes or terminates a process with verification.
 */
export async function closeProcess(target: string, force = false): Promise<ProcessActionResult> {
  if (process.platform !== "win32") {
    return {
      success: false,
      action: "close",
      verified: false,
      message: "Process management is only supported on Windows.",
      error: "Platform not win32",
    };
  }

  const proc = await findProcess(target);
  if (!proc) {
    return {
      success: false,
      action: force ? "terminate" : "close",
      verified: false,
      message: `Process for "${target}" not found or is already closed.`,
    };
  }

  // Step 1: Attempt graceful close first if not forced
  if (!force) {
    const gracefulScript = `
      $p = Get-Process -Id ${proc.id} -ErrorAction SilentlyContinue
      if ($p) {
        if ($p.MainWindowHandle -ne 0) {
          $p.CloseMainWindow() | Out-Null
        } else {
          $p.Kill()
        }
      }
    `;
    await runPowerShell(gracefulScript);
    await new Promise((r) => setTimeout(r, 400));

    // Verify if exited
    const verifyScript = `Get-Process -Id ${proc.id} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`;
    const check = await runPowerShell(verifyScript);
    const stillRunning = Boolean(check.stdout && check.stdout.trim() === String(proc.id));

    if (!stillRunning) {
      return {
        success: true,
        action: "close",
        processName: proc.name,
        processId: proc.id,
        verified: true,
        message: `Successfully closed process "${proc.name}" (PID: ${proc.id}).`,
      };
    }
  }

  // Step 2: Force termination if requested or if graceful close didn't exit
  const forceScript = `Stop-Process -Id ${proc.id} -Force -ErrorAction SilentlyContinue`;
  await runPowerShell(forceScript);
  await new Promise((r) => setTimeout(r, 300));

  const verifyScript = `Get-Process -Id ${proc.id} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`;
  const check = await runPowerShell(verifyScript);
  const stillRunning = Boolean(check.stdout && check.stdout.trim() === String(proc.id));

  return {
    success: !stillRunning,
    action: force ? "terminate" : "close",
    processName: proc.name,
    processId: proc.id,
    verified: !stillRunning,
    message: !stillRunning
      ? `Terminated process "${proc.name}" (PID: ${proc.id}).`
      : `Failed to terminate process "${proc.name}" (PID: ${proc.id}).`,
  };
}
