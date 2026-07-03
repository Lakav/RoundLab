import type { MatchData, Round } from "@/lib/types";
import type { MatchSummary, ParseOptions } from "@/lib/api";

export type DemoSource = { kind: "file"; file: File };

export type ParseProgress = {
  phase: string;
  progress: number;
  message: string;
  effectiveBytes?: number;
};

export type ProgressListener = (progress: ParseProgress) => void;

export type ParserBackend = {
  parseDemo(source: DemoSource, options?: ParseOptions): Promise<string>;
  cancelParse(): Promise<void>;
  onProgress(listener: ProgressListener): Promise<() => void>;
};

export type MatchStore = {
  listMatches(): Promise<MatchSummary[]>;
  getMatchMetadata(id: string): Promise<MatchData>;
  getRound(id: string, number: number, debugProjectiles?: boolean): Promise<Round>;
  deleteMatch(id: string): Promise<void>;
  renameMatch(id: string, name: string): Promise<MatchSummary>;
};

export type DiagnosticsBackend = {
  getDebugInfo(): Promise<Record<string, unknown>>;
  getLogFilePath(): Promise<string>;
  readLogTail(lines?: number): Promise<string>;
  readProjectileDebugLogs(lines?: number): Promise<{
    lines: string;
    rawTail: string;
    scannedLines: number;
    matchedLines: number;
    paths: string[];
    writtenPath: string;
    projectilePath: string;
    projectileSizeBytes: number;
    projectileLines: number;
  }>;
  getProjectileLogInfo(): Promise<{
    path: string;
    sizeBytes: number;
    lines: number;
  }>;
  openLogsFolder(): Promise<void>;
  openProjectileLogsFolder(): Promise<void>;
  openProjectileLogFile(): Promise<void>;
  writeDebugLog(source: string, message: string): Promise<string>;
};

export type ShellBackend = {
  getAppVersion(): Promise<string>;
  enterMatchFullscreen(): Promise<void>;
  exitMatchFullscreen(): Promise<void>;
};

export type RoundLabBackend = {
  parser: ParserBackend;
  matches: MatchStore;
  diagnostics: DiagnosticsBackend;
  shell: ShellBackend;
};
