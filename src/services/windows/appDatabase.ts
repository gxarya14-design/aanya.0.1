export interface AppDefinition {
  canonicalName: string;
  aliases: string[];
  processNames: string[];
  launchCommands: string[];
  titleKeywords: string[];
  protocolOrUri?: string;
}

export const KNOWN_APPLICATIONS: AppDefinition[] = [
  {
    canonicalName: "Google Chrome",
    aliases: ["chrome", "google chrome", "googlechrome", "browser", "net"],
    processNames: ["chrome"],
    launchCommands: ["chrome", "start chrome"],
    titleKeywords: ["google chrome", "chrome"],
  },
  {
    canonicalName: "Microsoft Edge",
    aliases: ["edge", "msedge", "microsoft edge", "microsoftedge"],
    processNames: ["msedge"],
    launchCommands: ["msedge", "start msedge"],
    titleKeywords: ["microsoft edge", "edge"],
  },
  {
    canonicalName: "Mozilla Firefox",
    aliases: ["firefox", "mozilla firefox", "mozilla"],
    processNames: ["firefox"],
    launchCommands: ["firefox", "start firefox"],
    titleKeywords: ["mozilla firefox", "firefox"],
  },
  {
    canonicalName: "Brave Browser",
    aliases: ["brave", "brave browser"],
    processNames: ["brave"],
    launchCommands: ["brave", "start brave"],
    titleKeywords: ["brave"],
  },
  {
    canonicalName: "Opera",
    aliases: ["opera", "opera gx", "operagx"],
    processNames: ["opera", "opera_gx"],
    launchCommands: ["opera", "start opera"],
    titleKeywords: ["opera"],
  },
  {
    canonicalName: "Visual Studio Code",
    aliases: ["vs code", "vscode", "code", "vsc", "visual studio code"],
    processNames: ["Code"],
    launchCommands: ["code", "start code"],
    titleKeywords: ["visual studio code", "visual studio", "- code"],
  },
  {
    canonicalName: "Notepad",
    aliases: ["notepad", "note pad", "text editor", "notepadd"],
    processNames: ["notepad"],
    launchCommands: ["notepad", "notepad.exe"],
    titleKeywords: ["notepad", "untitled - notepad"],
  },
  {
    canonicalName: "Calculator",
    aliases: ["calculator", "calc", "hisaab", "hisab"],
    processNames: ["CalculatorApp", "Calculator", "calc"],
    launchCommands: ["calc", "calc.exe"],
    titleKeywords: ["calculator"],
  },
  {
    canonicalName: "File Explorer",
    aliases: ["explorer", "file explorer", "files", "my computer", "this pc", "folder"],
    processNames: ["explorer"],
    launchCommands: ["explorer", "explorer.exe"],
    titleKeywords: ["file explorer", "this pc", "quick access"],
  },
  {
    canonicalName: "Task Manager",
    aliases: ["task manager", "taskmgr", "taskmanager", "processes"],
    processNames: ["Taskmgr"],
    launchCommands: ["taskmgr", "taskmgr.exe"],
    titleKeywords: ["task manager"],
  },
  {
    canonicalName: "Settings",
    aliases: ["settings", "system settings", "windows settings"],
    processNames: ["SystemSettings"],
    launchCommands: ["start ms-settings:"],
    titleKeywords: ["settings"],
    protocolOrUri: "ms-settings:",
  },
  {
    canonicalName: "Spotify",
    aliases: ["spotify", "music", "gaana"],
    processNames: ["Spotify"],
    launchCommands: ["spotify", "start spotify:"],
    titleKeywords: ["spotify", "spotify free", "spotify premium"],
    protocolOrUri: "spotify:",
  },
  {
    canonicalName: "VLC Media Player",
    aliases: ["vlc", "vlc player", "vlc media player"],
    processNames: ["vlc"],
    launchCommands: ["vlc", "start vlc"],
    titleKeywords: ["vlc media player", "vlc"],
  },
  {
    canonicalName: "Microsoft Word",
    aliases: ["word", "ms word", "winword", "microsoft word"],
    processNames: ["WINWORD"],
    launchCommands: ["winword", "start winword"],
    titleKeywords: ["word", "document - word"],
  },
  {
    canonicalName: "Microsoft Excel",
    aliases: ["excel", "ms excel", "sheet", "sheets", "microsoft excel"],
    processNames: ["EXCEL"],
    launchCommands: ["excel", "start excel"],
    titleKeywords: ["excel"],
  },
  {
    canonicalName: "Microsoft PowerPoint",
    aliases: ["powerpoint", "ppt", "ms powerpoint", "power point", "presentation"],
    processNames: ["POWERPNT"],
    launchCommands: ["powerpnt", "start powerpnt"],
    titleKeywords: ["powerpoint"],
  },
  {
    canonicalName: "WhatsApp",
    aliases: ["whatsapp", "whats app", "wp"],
    processNames: ["WhatsApp"],
    launchCommands: ["start whatsapp:", "whatsapp"],
    titleKeywords: ["whatsapp"],
    protocolOrUri: "whatsapp:",
  },
  {
    canonicalName: "Telegram",
    aliases: ["telegram", "tg"],
    processNames: ["Telegram"],
    launchCommands: ["telegram", "start telegram"],
    titleKeywords: ["telegram"],
  },
  {
    canonicalName: "Discord",
    aliases: ["discord"],
    processNames: ["Discord"],
    launchCommands: ["discord", "start discord"],
    titleKeywords: ["discord"],
  },
  {
    canonicalName: "Slack",
    aliases: ["slack"],
    processNames: ["slack"],
    launchCommands: ["slack", "start slack"],
    titleKeywords: ["slack"],
  },
  {
    canonicalName: "Zoom",
    aliases: ["zoom", "zoom meeting"],
    processNames: ["Zoom"],
    launchCommands: ["zoom", "start zoom"],
    titleKeywords: ["zoom", "zoom workplace"],
  },
  {
    canonicalName: "Microsoft Teams",
    aliases: ["teams", "microsoft teams", "msteams"],
    processNames: ["ms-teams", "Teams"],
    launchCommands: ["msteams", "start msteams:"],
    titleKeywords: ["microsoft teams", "teams"],
  },
  {
    canonicalName: "Paint",
    aliases: ["paint", "mspaint", "drawing"],
    processNames: ["mspaint"],
    launchCommands: ["mspaint", "start mspaint"],
    titleKeywords: ["paint"],
  },
  {
    canonicalName: "Command Prompt",
    aliases: ["cmd", "command prompt", "terminal", "console"],
    processNames: ["cmd", "OpenConsole"],
    launchCommands: ["cmd", "start cmd"],
    titleKeywords: ["command prompt", "cmd"],
  },
  {
    canonicalName: "Windows PowerShell",
    aliases: ["powershell", "ps"],
    processNames: ["powershell", "pwsh"],
    launchCommands: ["powershell", "start powershell"],
    titleKeywords: ["powershell", "windows powershell"],
  },
  {
    canonicalName: "Windows Terminal",
    aliases: ["wt", "windows terminal"],
    processNames: ["WindowsTerminal"],
    launchCommands: ["wt", "start wt"],
    titleKeywords: ["terminal", "windows terminal"],
  },
  {
    canonicalName: "Snipping Tool",
    aliases: ["snipping tool", "snip", "screenshot tool"],
    processNames: ["SnippingTool", "ScreenClippingHost"],
    launchCommands: ["snippingtool", "start ms-screenclip:"],
    titleKeywords: ["snipping tool"],
  },
  {
    canonicalName: "Steam",
    aliases: ["steam", "steam game"],
    processNames: ["steam"],
    launchCommands: ["steam", "start steam:"],
    titleKeywords: ["steam"],
    protocolOrUri: "steam:",
  },
  {
    canonicalName: "Epic Games Launcher",
    aliases: ["epic", "epic games", "epic launcher"],
    processNames: ["EpicGamesLauncher"],
    launchCommands: ["start com.epicgames.launcher:"],
    titleKeywords: ["epic games launcher", "epic games"],
  },
  {
    canonicalName: "Obsidian",
    aliases: ["obsidian", "notes"],
    processNames: ["Obsidian"],
    launchCommands: ["obsidian", "start obsidian:"],
    titleKeywords: ["obsidian"],
  },
  {
    canonicalName: "Notion",
    aliases: ["notion"],
    processNames: ["Notion"],
    launchCommands: ["notion"],
    titleKeywords: ["notion"],
  },
  {
    canonicalName: "Postman",
    aliases: ["postman", "api tool"],
    processNames: ["Postman"],
    launchCommands: ["postman"],
    titleKeywords: ["postman"],
  },
  {
    canonicalName: "Figma",
    aliases: ["figma", "design"],
    processNames: ["Figma"],
    launchCommands: ["figma"],
    titleKeywords: ["figma"],
  },
];

export function findAppDefinition(query: string): AppDefinition | null {
  if (!query || !query.trim()) return null;
  let clean = query.trim().toLowerCase();
  if (clean.endsWith(".exe")) {
    clean = clean.slice(0, -4).trim();
  }
  if (!clean) return null;

  // 1. Direct alias or canonical match
  for (const app of KNOWN_APPLICATIONS) {
    if (app.aliases.includes(clean)) return app;
    if (app.canonicalName.toLowerCase() === clean) return app;
    if (app.processNames.some((p) => p.toLowerCase() === clean)) return app;
  }

  // 2. Exact word boundary match in query
  for (const app of KNOWN_APPLICATIONS) {
    for (const a of app.aliases) {
      if (a.length >= 3) {
        const regex = new RegExp(`(^|\\s)${a}(\\s|$)`, "i");
        if (regex.test(clean)) return app;
      }
    }
    const canNorm = app.canonicalName.toLowerCase();
    if (canNorm.length >= 3) {
      const regex = new RegExp(`(^|\\s)${canNorm}(\\s|$)`, "i");
      if (regex.test(clean)) return app;
    }
  }

  // 3. Substring match for tokens of length >= 3
  if (clean.length >= 3) {
    for (const app of KNOWN_APPLICATIONS) {
      if (app.aliases.some((a) => a.length >= 3 && clean.includes(a))) {
        return app;
      }
      if (clean.includes(app.canonicalName.toLowerCase())) {
        return app;
      }
      if (app.titleKeywords.some((tk) => tk.length >= 3 && clean.includes(tk.toLowerCase()))) {
        return app;
      }
    }
  }

  return null;
}

export interface ResolvedApp {
  canonicalName: string;
  normalizedName: string;
  executable: string;
  processNames: string[];
  titleKeywords: string[];
  appDef: AppDefinition | null;
}

/**
 * Deterministic application resolution layer.
 * Resolves any user query (e.g. "Chrome", "Google Chrome", "chrome.exe")
 * into a canonical display name, base process names, executable name, and title keywords.
 */
export function resolveApplication(input: string): ResolvedApp {
  const raw = (input || "").trim();
  let clean = raw.toLowerCase();

  // Strip common conversational prefixes
  clean = clean.replace(/^(the\s+|app\s+|application\s+)/i, "").trim();

  // Strip .exe if present for base name
  const hasExe = clean.endsWith(".exe");
  const baseName = hasExe ? clean.slice(0, -4).trim() : clean;

  const appDef = findAppDefinition(raw) || findAppDefinition(baseName);

  if (appDef) {
    const primaryProc = (appDef.processNames[0] || baseName).toLowerCase().replace(/\.exe$/i, "");
    return {
      canonicalName: appDef.canonicalName,
      normalizedName: baseName,
      executable: `${primaryProc}.exe`,
      processNames: appDef.processNames.map((p) => p.toLowerCase().replace(/\.exe$/i, "")),
      titleKeywords: appDef.titleKeywords.map((k) => k.toLowerCase()),
      appDef,
    };
  }

  // Fallback for custom / uncatalogued applications
  const procName = baseName.replace(/\.exe$/i, "");
  return {
    canonicalName: raw,
    normalizedName: procName,
    executable: `${procName}.exe`,
    processNames: [procName],
    titleKeywords: [procName, raw.toLowerCase()],
    appDef: null,
  };
}
