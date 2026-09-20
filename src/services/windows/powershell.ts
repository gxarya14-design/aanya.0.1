import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface PowerShellResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export function encodePowerShellCommand(script: string): string {
  const scriptBuffer = Buffer.from(script, "utf16le");
  return scriptBuffer.toString("base64");
}

export async function runPowerShell(script: string, timeoutMs = 6000): Promise<PowerShellResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      stdout: "",
      stderr: "PowerShell is only supported on Windows.",
      error: "Not on Windows",
    };
  }

  // Base64 encode script to completely avoid escaping issues with quotes, brackets, and newlines
  const encodedCommand = encodePowerShellCommand(script);
  const cmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedCommand}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      ok: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (err: any) {
    return {
      ok: false,
      stdout: err?.stdout ? String(err.stdout).trim() : "",
      stderr: err?.stderr ? String(err.stderr).trim() : String(err?.message || err),
      error: String(err?.message || err),
    };
  }
}

export async function runPowerShellJSON<T>(script: string, timeoutMs = 6000): Promise<T | null> {
  const cleanScript = script.trim();
  const fullScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    & {
      ${cleanScript}
    } | ConvertTo-Json -Compress -Depth 4
  `;
  const res = await runPowerShell(fullScript, timeoutMs);
  if (!res.ok || !res.stdout) return null;

  try {
    return JSON.parse(res.stdout) as T;
  } catch {
    return null;
  }
}
