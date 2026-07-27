import type {
  MatchAnalysis,
  PlayerAnalysisMetrics,
} from "./types";

export const BENCHMARK_CORPUS_SPEC_VERSION =
  "roundlab.benchmarks.corpus.v1" as const;

export type BenchmarkMatchInput = {
  analysis: MatchAnalysis;
  map: string;
  level: string;
  playedAt: string;
};

export type BenchmarkPlayerSideSample = {
  sampleId: string;
  matchId: string;
  playerId: string;
  map: string;
  level: string;
  side: "T" | "CT";
  playedAt: string;
  metricsSpecVersion: string;
  inputSchemaVersion: string;
  parserVersion: string;
  roundsPlayed: number;
  metrics: PlayerAnalysisMetrics;
};

export type BenchmarkRoundOutcomeSample = {
  sampleId: string;
  matchId: string;
  roundNumber: number;
  map: string;
  level: string;
  side: "T" | "CT";
  won: boolean;
  playedAt: string;
  metricsSpecVersion: string;
  inputSchemaVersion: string;
  parserVersion: string;
};

export type BenchmarkStratumCoverage = {
  map: string;
  level: string;
  side: "T" | "CT";
  matchCount: number;
  playerCount: number;
  sampleCount: number;
  playerRounds: number;
};

export type BenchmarkCorpusAudit = {
  matchCount: number;
  playerCount: number;
  sampleCount: number;
  roundOutcomeSampleCount: number;
  maps: string[];
  levels: string[];
  strata: BenchmarkStratumCoverage[];
  unavailableReasons: string[];
};

export type BenchmarkCorpus = {
  specVersion: typeof BENCHMARK_CORPUS_SPEC_VERSION;
  generatedAt: string;
  samples: BenchmarkPlayerSideSample[];
  roundOutcomeSamples: BenchmarkRoundOutcomeSample[];
  audit: BenchmarkCorpusAudit;
};

export type BenchmarkReadinessPolicy = {
  maps: string[];
  levels: string[];
  minimumMatchCount: number;
  minimumPlayerCount: number;
  minimumPlayerSampleCount: number;
  minimumPlayerRounds: number;
  minimumRoundOutcomeCount: number;
};

export type BenchmarkStratumReadiness = BenchmarkStratumCoverage & {
  roundOutcomeCount: number;
  incompatibleAnalysisSampleCount: number;
  ready: boolean;
  unavailableReasons: Array<
    | "missing_stratum"
    | "insufficient_matches"
    | "insufficient_players"
    | "insufficient_player_samples"
    | "insufficient_player_rounds"
    | "insufficient_round_outcomes"
    | "incompatible_analysis_versions"
  >;
};

export type BenchmarkCorpusReadiness = {
  readinessVersion: "roundlab.benchmark-readiness.v1";
  ready: boolean;
  policy: BenchmarkReadinessPolicy;
  requiredStratumCount: number;
  readyStratumCount: number;
  strata: BenchmarkStratumReadiness[];
  unavailableReasons: string[];
};

export type BenchmarkCollectionProvenance = {
  sourceType: "player_upload" | "licensed_dataset" | "organization";
  sourceReference: string;
  authorizationBasis:
    | "player_consent"
    | "dataset_license"
    | "organization_agreement";
  collectedAt: string;
};

export type BenchmarkCollectionManifestEntry = {
  analysisPath: string;
  map: string;
  level: string;
  playedAt: string;
  provenance: BenchmarkCollectionProvenance;
};

export type BenchmarkCollectionManifest = {
  manifestVersion: "roundlab.benchmark-collection-manifest.v1";
  corpusGeneratedAt: string;
  policy: {
    maps: string[];
    levels: string[];
    minimumMatchCount?: number;
    minimumPlayerCount?: number;
    minimumPlayerSampleCount?: number;
    minimumPlayerRounds?: number;
    minimumRoundOutcomeCount?: number;
  };
  entries: BenchmarkCollectionManifestEntry[];
};

export type BenchmarkCorpusBundle = {
  bundleVersion: "roundlab.benchmark-corpus-bundle.v1";
  corpus: BenchmarkCorpus;
  readiness: BenchmarkCorpusReadiness;
  provenance: Array<{
    matchId: string;
    analysisPath: string;
    provenance: BenchmarkCollectionProvenance;
  }>;
};

export type BenchmarkMetricId =
  | "kills_per_round"
  | "deaths_per_round"
  | "assists_per_round"
  | "kd_ratio"
  | "headshot_rate"
  | "adr"
  | "opening_win_rate"
  | "survival_rate"
  | "trade_kill_rate"
  | "kast_rate"
  | "grenades_per_round"
  | "flash_assists_per_round";

export type BenchmarkDistribution = {
  distributionId: string;
  map: string;
  level: string;
  side: "T" | "CT";
  metric: BenchmarkMetricId;
  values: number[];
  sampleCount: number;
  excludedSampleCount: number;
};

export type BenchmarkPercentile = 10 | 25 | 50 | 75 | 90;

export type BenchmarkConfidenceInterval = {
  confidenceLevel: 0.95;
  lower: number;
  upper: number;
  method: "dkw_nonparametric";
};

export type BenchmarkQuantileEstimate = {
  percentile: BenchmarkPercentile;
  value: number | null;
  confidenceInterval: BenchmarkConfidenceInterval | null;
  unavailableReason:
    | "empty_distribution"
    | "insufficient_samples_for_confidence_interval"
    | null;
};

export type BenchmarkDistributionSummary = {
  summaryId: string;
  distributionId: string;
  map: string;
  level: string;
  side: "T" | "CT";
  metric: BenchmarkMetricId;
  sampleCount: number;
  excludedSampleCount: number;
  median: BenchmarkQuantileEstimate;
  percentiles: BenchmarkQuantileEstimate[];
};

export type WinProbabilityModel = {
  modelId: string;
  modelVersion: "roundlab.win-probability.wilson.v1";
  map: string;
  level: string;
  side: "T" | "CT";
  sampleCount: number;
  winCount: number;
  probability: number | null;
  confidenceInterval: {
    confidenceLevel: 0.95;
    lower: number;
    upper: number;
    method: "wilson_score";
  } | null;
  unavailableReason: "insufficient_round_samples" | null;
};

export type BenchmarkScoreContribution = {
  metric: BenchmarkMetricId;
  orientation: "higher_is_better" | "lower_is_better";
  value: number;
  benchmarkSampleCount: number;
  percentile: number;
  orientedPercentile: number;
  points: number;
  impact: "gain" | "loss" | "neutral";
};

export type BenchmarkScore = {
  scoreVersion: "roundlab.benchmark-score.v1";
  playerId: string;
  map: string;
  level: string;
  side: "T" | "CT";
  score: number | null;
  baseScore: 50;
  contributions: BenchmarkScoreContribution[];
  unavailableReasons: string[];
};

export type PlayerHistoryMetrics = {
  roundsPlayed: number;
  values: Record<BenchmarkMetricId, number | null>;
};

export type PlayerHistoryGroup = {
  groupId: string;
  sampleCount: number;
  matchCount: number;
  metrics: PlayerHistoryMetrics;
};

export type PlayerHistory = {
  historyVersion: "roundlab.player-history.v1";
  playerId: string;
  sampleCount: number;
  matchCount: number;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  samples: BenchmarkPlayerSideSample[];
  overall: PlayerHistoryGroup;
  byMap: PlayerHistoryGroup[];
  bySide: PlayerHistoryGroup[];
  unavailableReasons: string[];
};

export type PlayerMetricTrend = {
  trendId: string;
  map: string;
  side: "T" | "CT";
  metric: BenchmarkMetricId;
  orientation: "higher_is_better" | "lower_is_better";
  sampleCount: number;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  firstValue: number | null;
  lastValue: number | null;
  kendallTau: number | null;
  zScore: number | null;
  pValue: number | null;
  direction: "improving" | "regressing" | "stable" | "unavailable";
  evidenceSampleIds: string[];
  unavailableReason: "insufficient_metric_samples" | null;
};

export type PlayerTrendAnalysis = {
  trendVersion: "roundlab.player-trends.mann-kendall.v1";
  playerId: string;
  minimumSampleCount: number;
  significanceLevel: 0.05;
  trends: PlayerMetricTrend[];
  unavailableReasons: string[];
};

export type RecurringPlayerError = {
  errorId: string;
  category: "benchmark_weakness";
  map: string;
  level: string;
  side: "T" | "CT";
  metric: BenchmarkMetricId;
  windowSampleCount: number;
  weakSampleCount: number;
  weakRate: number;
  meanOrientedPercentile: number;
  firstPlayedAt: string;
  lastPlayedAt: string;
  evidenceSampleIds: string[];
};

export type RecurringPlayerErrorAnalysis = {
  analysisVersion: "roundlab.recurring-errors.v1";
  playerId: string;
  windowSize: 5;
  minimumOccurrences: 3;
  maximumWeakPercentile: 25;
  errors: RecurringPlayerError[];
  unavailableSeries: string[];
  unavailableReasons: string[];
};

export type PlayerTrainingObjective = {
  objectiveId: string;
  map: string;
  level: string;
  side: "T" | "CT";
  metric: BenchmarkMetricId;
  orientation: "higher_is_better" | "lower_is_better";
  baselineMeanValue: number;
  targetValue: number;
  targetComparator: "at_least" | "at_most";
  evaluationWindowSampleCount: 5;
  requiredSuccessCount: 3;
  benchmarkSampleCount: number;
  sourceErrorId: string;
  sourceWeakRate: number;
  evidenceSampleIds: string[];
};

export type PlayerTrainingObjectiveAnalysis = {
  objectiveVersion: "roundlab.training-objectives.v1";
  playerId: string;
  objectives: PlayerTrainingObjective[];
  unavailableErrorIds: string[];
  unavailableReasons: string[];
};

export type PlayerFindingSummaryItem = {
  findingId: string;
  category: "regression" | "improvement" | "recurring_error" | "objective";
  sourceId: string;
  text: string;
  evidenceSampleIds: string[];
};

export type PlayerFindingsSummary = {
  summaryVersion: "roundlab.player-findings-summary.v1";
  playerId: string;
  headline: string;
  findings: PlayerFindingSummaryItem[];
  unavailableReasons: string[];
};
