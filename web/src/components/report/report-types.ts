import type { MatchAnalysis } from "@/lib/analysis/types";
import type { MechanicsAnalysis } from "@/lib/analysis/mechanics-types";
import type { SpatialAnalysis } from "@/lib/analysis/spatial-types";

export type ReportTab = "overview" | "details" | "headToHead" | "rating" | "mapZones";
export type OverviewMetricSet = "general" | "aim" | "positioning" | "utility";
export type DetailSection =
  | "general"
  | "timeline"
  | "aim"
  | "utility"
  | "activity"
  | "trades"
  | "weapons"
  | "openings"
  | "clutches";

export type MatchReportProps = {
  analysis: MatchAnalysis | null;
  mechanics: MechanicsAnalysis | null;
  spatial: SpatialAnalysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenPositioning: (playerId: string) => void;
};
