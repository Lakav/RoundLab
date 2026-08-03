import type { MatchData, Round } from "@/lib/types";
import type { MatchSummary } from "@/lib/api";
import type { BrowserParseMode } from "@/lib/parser-memory";
import type { BenchmarkContributionSettings } from "@/lib/analysis/benchmark-contribution";

export type DemoSource = { kind: "file"; file: File };
export type ParseOptions = { mode: BrowserParseMode };

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
  getCompleteMatch(id: string): Promise<MatchData>;
  getRound(id: string, number: number, debugProjectiles?: boolean): Promise<Round>;
  deleteMatch(id: string): Promise<void>;
  renameMatch(id: string, name: string): Promise<MatchSummary>;
  saveBenchmarkContribution(
    id: string,
    settings: BenchmarkContributionSettings,
  ): Promise<MatchSummary>;
};

export type DiagnosticsBackend = {
  getDebugInfo(): Promise<Record<string, unknown>>;
  writeDebugLog(source: string, message: string): Promise<void>;
};

export type ShellBackend = {
  enterMatchFullscreen(): Promise<void>;
  exitMatchFullscreen(): Promise<void>;
};

export type RoundLabBackend = {
  parser: ParserBackend;
  matches: MatchStore;
  diagnostics: DiagnosticsBackend;
  shell: ShellBackend;
};
