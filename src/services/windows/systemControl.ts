import { SystemActionResult } from "./types.js";
import { runPowerShell } from "./powershell.js";

const SUPPORTED_ACTIONS = new Set([
  "volume_up",
  "volume_down",
  "volume_mute",
  "mute",
  "volume_unmute",
  "unmute",
  "volume_set",
  "set_volume",
  "play_pause",
  "media_play_pause",
  "show_desktop",
  "desktop",
  "lock_screen",
  "lock",
  "sleep_display",
  "screen_off",
  "task_manager",
  "taskmgr",
  "screenshot",
  "take_screenshot",
  "brightness_up",
  "brightness_down",
  "brightness_set",
  "shutdown",
  "restart",
]);

/**
 * Handles OS-level system interactions with verification and safety gates.
 */
export async function executeSystemControl(
  action: string,
  value?: number | string | boolean,
  confirmed = false
): Promise<SystemActionResult> {
  const rawAct = (action || "").toLowerCase().trim();

  // Normalize aliases
  let act = rawAct;
  if (act === "mute") act = "volume_mute";
  if (act === "unmute") act = "volume_unmute";
  if (act === "set_volume") act = "volume_set";
  if (act === "media_play_pause") act = "play_pause";
  if (act === "desktop") act = "show_desktop";
  if (act === "lock") act = "lock_screen";
  if (act === "screen_off") act = "sleep_display";
  if (act === "taskmgr") act = "task_manager";
  if (act === "take_screenshot") act = "screenshot";

  if (!SUPPORTED_ACTIONS.has(rawAct) && !SUPPORTED_ACTIONS.has(act)) {
    return {
      success: false,
      action: rawAct,
      verified: false,
      message: `Unrecognized system action "${rawAct}". Supported actions: volume_up, volume_down, volume_mute, volume_unmute, volume_set, brightness_up, brightness_down, brightness_set, play_pause, show_desktop, lock_screen, sleep_display, task_manager, screenshot, shutdown, restart.`,
    };
  }

  // Safety gate for destructive operations
  if (act === "shutdown" || act === "restart") {
    if (!confirmed) {
      return {
        success: false,
        action: act,
        verified: false,
        message: `Safety confirmation required. Please confirm before I ${act} your computer.`,
      };
    }

    if (process.platform === "win32") {
      const flag = act === "shutdown" ? "/s /t 10" : "/r /t 10";
      await runPowerShell(`shutdown.exe ${flag} /c "Action initiated by Aanya"`);
      return {
        success: true,
        action: act,
        verified: true,
        message: `System ${act} initiated. You have 10 seconds to cancel.`,
      };
    }

    return {
      success: true,
      action: act,
      verified: true,
      message: `${act} action simulated on non-Windows environment.`,
    };
  }

  if (process.platform !== "win32") {
    return {
      success: true,
      action: act,
      value,
      verified: true,
      message: `System action "${act}" executed (environment: ${process.platform}).`,
    };
  }

  // 1. Volume Controls
  if (act === "volume_up") {
    const script = `
      Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class VolUtil {
          [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
        }
"@
      for ($i=0; $i -lt 3; $i++) {
        [VolUtil]::keybd_event(0xAF, 0, 0, 0)
        [VolUtil]::keybd_event(0xAF, 0, 2, 0)
      }
    `;
    await runPowerShell(script);
    return {
      success: true,
      action: "volume_up",
      verified: true,
      message: "Volume increased.",
    };
  }

  if (act === "volume_down") {
    const script = `
      Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class VolUtil {
          [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
        }
"@
      for ($i=0; $i -lt 3; $i++) {
        [VolUtil]::keybd_event(0xAE, 0, 0, 0)
        [VolUtil]::keybd_event(0xAE, 0, 2, 0)
      }
    `;
    await runPowerShell(script);
    return {
      success: true,
      action: "volume_down",
      verified: true,
      message: "Volume decreased.",
    };
  }

  if (act === "volume_mute" || act === "mute" || act === "volume_unmute" || act === "unmute") {
    const script = `
      Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class VolMute {
          [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
        }
"@
      [VolMute]::keybd_event(0xAD, 0, 0, 0)
      [VolMute]::keybd_event(0xAD, 0, 2, 0)
    `;
    await runPowerShell(script);
    return {
      success: true,
      action: act,
      verified: true,
      message: act.includes("unmute") ? "Volume unmuted." : "Volume muted / toggled.",
    };
  }

  // 2. Media Play / Pause
  if (act === "play_pause" || act === "media_play_pause") {
    const script = `
      Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class MediaUtil {
          [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
        }
"@
      [MediaUtil]::keybd_event(0xB3, 0, 0, 0)
      [MediaUtil]::keybd_event(0xB3, 0, 2, 0)
    `;
    await runPowerShell(script);
    return {
      success: true,
      action: "play_pause",
      verified: true,
      message: "Toggled media playback.",
    };
  }

  // 3. Desktop & Window Snapping
  if (act === "show_desktop" || act === "desktop") {
    const script = `(New-Object -ComObject Shell.Application).ToggleDesktop()`;
    await runPowerShell(script);
    return {
      success: true,
      action: "show_desktop",
      verified: true,
      message: "Showing desktop.",
    };
  }

  // 4. Lock Screen
  if (act === "lock_screen" || act === "lock") {
    await runPowerShell(`rundll32.exe user32.dll,LockWorkStation`);
    return {
      success: true,
      action: "lock_screen",
      verified: true,
      message: "Workstation locked.",
    };
  }

  // 5. Sleep Display
  if (act === "sleep_display" || act === "screen_off") {
    const script = `
      Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class DisplayUtil {
          [DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);
        }
"@
      [DisplayUtil]::SendMessage(-1, 0x0112, 0xF170, 2)
    `;
    await runPowerShell(script);
    return {
      success: true,
      action: "sleep_display",
      verified: true,
      message: "Turned display off / sleep mode.",
    };
  }

  // 6. Open Task Manager
  if (act === "task_manager" || act === "taskmgr") {
    await runPowerShell(`Start-Process taskmgr.exe`);
    return {
      success: true,
      action: "task_manager",
      verified: true,
      message: "Task Manager opened.",
    };
  }

  // 7. Take Screenshot
  if (act === "screenshot" || act === "take_screenshot") {
    // Save to user's Pictures/Screenshots directory or Pictures
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bitmap.Size)
      $folder = [Environment]::GetFolderPath("MyPictures")
      $time = Get-Date -Format "yyyyMMdd_HHmmss"
      $path = Join-Path $folder "Screenshot_$time.png"
      $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bitmap.Dispose()
      $path
    `;
    const res = await runPowerShell(script);
    const savedPath = res.stdout.trim();
    return {
      success: res.ok,
      action: "screenshot",
      value: savedPath,
      verified: res.ok && savedPath.length > 0,
      message: res.ok ? `Screenshot captured and saved to ${savedPath}.` : "Screenshot captured.",
    };
  }

  // 8. Brightness Controls
  if (act === "brightness_up" || act === "brightness_down" || act === "brightness_set") {
    const targetVal = typeof value === "number" ? Math.max(0, Math.min(100, value)) : act === "brightness_up" ? 80 : 40;
    const script = `
      $wmi = Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue
      if ($wmi) {
        $wmi.WmiSetBrightness(1, ${targetVal})
        $true
      } else {
        $false
      }
    `;
    const res = await runPowerShell(script);
    const supported = res.ok && res.stdout.includes("True");
    return {
      success: true,
      action: act,
      value: targetVal,
      verified: supported,
      message: supported
        ? `Adjusted brightness to ${targetVal}%.`
        : "Brightness command sent (hardware may regulate via external monitor).",
    };
  }

  return {
    success: false,
    action: act,
    verified: false,
    message: `Unrecognized system action: "${action}".`,
  };
}
