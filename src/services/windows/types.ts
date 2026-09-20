export type WindowState = "normal" | "minimized" | "maximized" | "hidden";

export interface WindowInfo {
  hwnd: number;
  title: string;
  processName: string;
  processId: number;
  state?: WindowState;
  bounds?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  isActive?: boolean;
}

export interface ProcessInfo {
  id: number;
  name: string;
  title?: string;
  path?: string;
  cpu?: number;
  memoryMB?: number;
  responding?: boolean;
}

export interface WindowActionResult {
  success: boolean;
  action: "minimize" | "maximize" | "restore" | "close" | "focus" | "switch";
  targetRequested?: string;
  resolvedTitle?: string;
  resolvedProcessName?: string;
  hwnd?: number;
  verified: boolean;
  message: string;
  error?: string;
}

export interface ProcessActionResult {
  success: boolean;
  action: "launch" | "close" | "terminate" | "list";
  processName?: string;
  processId?: number;
  verified: boolean;
  message: string;
  error?: string;
}

export interface SystemActionResult {
  success: boolean;
  action: string;
  value?: string | number | boolean;
  verified: boolean;
  message: string;
  error?: string;
}
