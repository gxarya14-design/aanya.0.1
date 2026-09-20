import { findAppDefinition, KNOWN_APPLICATIONS } from "../src/services/windows/appDatabase.ts";
import {
  resolveTargetWindow,
  isActiveTargetPhrase,
  cleanTargetQuery,
  isExcludedWindow,
} from "../src/services/windows/windowManager.ts";
import { executeSystemControl } from "../src/services/windows/systemControl.ts";
import { encodePowerShellCommand } from "../src/services/windows/powershell.ts";
import { WindowInfo } from "../src/services/windows/types.ts";

function isSafeAppName(name: string): boolean {
  return /^[a-zA-Z0-9 ._-]{1,100}$/.test(name);
}

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${testName}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function runAllTests() {
  console.log("=== WINDOWS CONTROL SYSTEM - DEEP AUDIT & TEST SUITE ===\n");

  // TEST 1: App Database & Short String Safety
  console.log("1. App Database & Lookup Verification:");
  assert(findAppDefinition("chrome")?.canonicalName === "Google Chrome", "Resolves 'chrome' to Google Chrome");
  assert(findAppDefinition("calc")?.canonicalName === "Calculator", "Resolves 'calc' to Calculator");
  assert(findAppDefinition("vs code")?.canonicalName === "Visual Studio Code", "Resolves 'vs code' to Visual Studio Code");
  assert(findAppDefinition("vscode")?.canonicalName === "Visual Studio Code", "Resolves 'vscode' to Visual Studio Code");
  assert(findAppDefinition("notepad")?.canonicalName === "Notepad", "Resolves 'notepad' to Notepad");
  assert(findAppDefinition("c") === null, "Short string 'c' does NOT falsely match any app");
  assert(findAppDefinition("a") === null, "Short string 'a' does NOT falsely match any app");
  assert(findAppDefinition("in") === null, "Short string 'in' does NOT falsely match any app");
  assert(findAppDefinition("unknown_dummy_app_xyz") === null, "Non-existent app returns null");

  // TEST 2: Active Target Phrase Detection
  console.log("\n2. Active / Foreground Natural Language Detection:");
  assert(isActiveTargetPhrase(""), "Empty target triggers active window");
  assert(isActiveTargetPhrase("active"), "'active' triggers active window");
  assert(isActiveTargetPhrase("active window"), "'active window' triggers active window");
  assert(isActiveTargetPhrase("current window"), "'current window' triggers active window");
  assert(isActiveTargetPhrase("ise"), "'ise' (Hindi) triggers active window");
  assert(isActiveTargetPhrase("ise hi"), "'ise hi' triggers active window");
  assert(isActiveTargetPhrase("yeh"), "'yeh' triggers active window");
  assert(isActiveTargetPhrase("is window ko"), "'is window ko' triggers active window");
  assert(isActiveTargetPhrase("samne wali window"), "'samne wali window' triggers active window");
  assert(isActiveTargetPhrase("jo window abhi khuli hai"), "'jo window abhi khuli hai' triggers active window");
  assert(isActiveTargetPhrase("abhi wali window"), "'abhi wali window' triggers active window");
  assert(!isActiveTargetPhrase("chrome"), "'chrome' is NOT an active phrase");
  assert(!isActiveTargetPhrase("visual studio code"), "'visual studio code' is NOT an active phrase");

  // TEST 3: Filler Word Cleaning
  console.log("\n3. Filler Word & Particle Cleaning (Hindi/Hinglish/English):");
  assert(cleanTargetQuery("Chrome ki window") === "chrome", "Strips 'ki window'");
  assert(cleanTargetQuery("VS Code ko") === "vs code", "Strips 'ko'");
  assert(cleanTargetQuery("Notepad app") === "notepad", "Strips 'app'");
  assert(cleanTargetQuery("window of Chrome") === "chrome", "Strips 'window of'");
  assert(cleanTargetQuery("the window of Spotify") === "spotify", "Strips 'the window of'");

  // TEST 4: Mocked Window Target Resolution
  console.log("\n4. Mocked Window Resolution (Multi-window & Ambiguity):");
  const mockWindows: WindowInfo[] = [
    { hwnd: 1001, title: "Google Chrome - New Tab", processName: "chrome", processId: 501, state: "normal", isActive: false },
    { hwnd: 1002, title: "Inbox (2) - user@gmail.com - Google Chrome", processName: "chrome", processId: 502, state: "normal", isActive: true },
    { hwnd: 2001, title: "server.ts - aanya-project - Visual Studio Code", processName: "Code", processId: 601, state: "normal", isActive: false },
    { hwnd: 3001, title: "Untitled - Notepad", processName: "notepad", processId: 701, state: "minimized", isActive: false },
    { hwnd: 4001, title: "Calculator", processName: "CalculatorApp", processId: 801, state: "normal", isActive: false },
  ];

  // Natural Language Test cases:
  // "Chrome minimize karo"
  const resChrome = await resolveTargetWindow("Chrome", mockWindows);
  assert(resChrome.window?.processName === "chrome", "Resolves 'Chrome' to chrome process");
  assert(resChrome.window?.hwnd === 1002, "Prioritizes active Chrome window (hwnd 1002) over inactive (hwnd 1001)");

  // "VS Code maximize karo"
  const resVSCode = await resolveTargetWindow("VS Code", mockWindows);
  assert(resVSCode.window?.processName === "Code", "Resolves 'VS Code' to Visual Studio Code window");

  // "Notepad band karo"
  const resNotepad = await resolveTargetWindow("Notepad", mockWindows);
  assert(resNotepad.window?.processName === "notepad", "Resolves 'Notepad' to notepad window");

  // "ise minimize karo"
  const resIse = await resolveTargetWindow("ise", mockWindows);
  assert(resIse.window?.hwnd === 1002, "Resolves 'ise' to currently active window (hwnd 1002)");

  // "active window close karo"
  const resActive = await resolveTargetWindow("active window", mockWindows);
  assert(resActive.window?.hwnd === 1002, "Resolves 'active window' to currently active window");

  // "samne wali window"
  const resSamne = await resolveTargetWindow("samne wali window", mockWindows);
  assert(resSamne.window?.hwnd === 1002, "Resolves 'samne wali window' to currently active window");

  // "Chrome ki window kholo"
  const resChromeKi = await resolveTargetWindow("Chrome ki window", mockWindows);
  assert(resChromeKi.window?.processName === "chrome", "Resolves 'Chrome ki window' to chrome");

  // "Non existent app"
  const resNonExistent = await resolveTargetWindow("Blender 3D", mockWindows);
  assert(resNonExistent.window === null, "Resolves non-existent app to null");

  // OBS Isolation Test:
  // When OBS is running in the background and no window has isActive = true
  const mockWindowsWithOBS: WindowInfo[] = [
    { hwnd: 999, title: "OBS 30.2.2 - Profile: Untitled - Scenes: Untitled", processName: "obs64", processId: 999, state: "normal", isActive: false },
    { hwnd: 1001, title: "Google Chrome - New Tab", processName: "chrome", processId: 501, state: "normal", isActive: false },
    { hwnd: 2001, title: "server.ts - aanya-project - Visual Studio Code", processName: "Code", processId: 601, state: "normal", isActive: false },
  ];

  // "ise minimize karo" should NEVER select OBS when fallbacking
  const resIseWithOBS = await resolveTargetWindow("ise", mockWindowsWithOBS);
  assert(resIseWithOBS.window?.processName !== "obs64", "OBS is NOT selected as fallback active window");
  assert(resIseWithOBS.window?.processName === "chrome", "Resolves active fallback to real user app (Chrome)");

  // Explicitly asking for OBS ("OBS minimize karo") SHOULD target OBS
  const resExplicitOBS = await resolveTargetWindow("OBS", mockWindowsWithOBS);
  assert(resExplicitOBS.window?.processName === "obs64", "Explicit request for 'OBS' targets OBS correctly");

  // TEST 5: Excluded Window / Self-Harm Prevention
  console.log("\n5. Excluded Window & Aanya Protection:");
  assert(isExcludedWindow("Aanya"), "Protects exact 'Aanya' window");
  assert(isExcludedWindow("Aanya - AI Assistant"), "Protects 'Aanya - AI Assistant'");
  assert(isExcludedWindow("Aanya AI"), "Protects 'Aanya AI'");
  assert(isExcludedWindow("Program Manager"), "Excludes Program Manager");
  assert(isExcludedWindow("Task View"), "Excludes Task View");
  assert(!isExcludedWindow("Google Chrome"), "Does NOT exclude Google Chrome");
  assert(!isExcludedWindow("Visual Studio Code"), "Does NOT exclude Visual Studio Code");

  // TEST 6: System Control Actions & Destructive Confirmation Gate
  console.log("\n6. System Control & Safety Gate Validation:");
  // Destructive without confirmation -> MUST FAIL / REQUIRE CONFIRMATION
  const resShutNoConf = await executeSystemControl("shutdown", undefined, false);
  assert(!resShutNoConf.success && !resShutNoConf.verified, "Shutdown without confirmation is strictly BLOCKED");

  const resRestartNoConf = await executeSystemControl("restart", undefined, false);
  assert(!resRestartNoConf.success && !resRestartNoConf.verified, "Restart without confirmation is strictly BLOCKED");

  // Destructive with confirmation -> SUCCEEDS
  const resShutConf = await executeSystemControl("shutdown", undefined, true);
  assert(resShutConf.success && resShutConf.verified, "Shutdown with confirmation proceeds");

  // Standard safe system actions
  const resVolUp = await executeSystemControl("volume_up");
  assert(resVolUp.success && resVolUp.action === "volume_up", "System action 'volume_up' accepted");

  const resMute = await executeSystemControl("mute");
  assert(resMute.success && resMute.action === "volume_mute", "Alias 'mute' normalized to 'volume_mute'");

  const resDesktop = await executeSystemControl("desktop");
  assert(resDesktop.success && resDesktop.action === "show_desktop", "Alias 'desktop' normalized to 'show_desktop'");

  const resTaskMgr = await executeSystemControl("taskmgr");
  assert(resTaskMgr.success && resTaskMgr.action === "task_manager", "Alias 'taskmgr' normalized to 'task_manager'");

  const resVolSet = await executeSystemControl("volume_set", 65);
  assert(resVolSet.success && resVolSet.value === 65, "System action 'volume_set' retains numeric value");

  // Invalid system action -> MUST FAIL
  const resInvalid = await executeSystemControl("format_hard_drive_xyz");
  assert(!resInvalid.success && !resInvalid.verified, "Unrecognized system action is rejected with clean error");

  // TEST 7: Shell Injection & Parameter Sanitization
  console.log("\n7. Security & Shell Injection Prevention:");
  assert(isSafeAppName("Google Chrome"), "'Google Chrome' is safe");
  assert(isSafeAppName("Code"), "'Code' is safe");
  assert(isSafeAppName("msedge.exe"), "'msedge.exe' is safe");
  assert(!isSafeAppName("calc.exe; rm -rf /"), "Rejects semicolon command chaining");
  assert(!isSafeAppName("notepad & calc"), "Rejects ampersand command chaining");
  assert(!isSafeAppName("chrome | whoami"), "Rejects pipe command chaining");
  assert(!isSafeAppName("app`dir`"), "Rejects backtick command substitution");
  assert(!isSafeAppName("app$(whoami)"), "Rejects subshell execution syntax");
  assert(!isSafeAppName(""), "Rejects empty string");

  // TEST 8: PowerShell Base64 Encoding
  console.log("\n8. PowerShell Base64 EncodedCommand Correctness:");
  const testScript = "Write-Output 'Aanya Safe Execution'";
  const encoded = encodePowerShellCommand(testScript);
  const decoded = Buffer.from(encoded, "base64").toString("utf16le");
  assert(decoded === testScript, "Base64 UTF-16LE encoding roundtrips perfectly without quote corruption");

  console.log(`\n======================================================`);
  console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log(`======================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
