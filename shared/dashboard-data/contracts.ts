export const DASHBOARD_SCHEMA_VERSION = "1.0.0" as const;
export const DASHBOARD_READER_VERSION = "1.0.0" as const;

export interface DashboardDatasetManifest {
  file: string;
  record_count: number | null;
  bytes: number;
  sha256: string;
  available: boolean;
  reason: string | null;
  period: { from: string | null; to: string | null } | null;
}

export interface DashboardManifest {
  schema_version: string;
  minimum_reader_version: string;
  package_version: string;
  generated_at: string;
  source: string;
  timezone: string;
  datasets: Record<string, DashboardDatasetManifest>;
  matching_baseline?: {
    file: string;
    bytes: number;
    sha256: string | null;
    available: boolean;
  };
}

export interface TenderProjectData {
  id: string;
  broker_name: string;
  is_broker_project: boolean | null;
  publish_date: string;
  publish_timestamp: number | null;
  announcement_stage: string;
  project_name: string;
  normalized_project_name: string;
  procurement_method: string;
  budget_amount_yuan: number | null;
  winning_amount_yuan: number | null;
  display_amount_yuan: number | null;
  display_amount_kind: "winning" | "budget" | null;
  supplier_name: string;
  source_name: string;
  processed_at: string;
  project_key: string;
  amount_sample_key: string | null;
  primary_domain: string;
  topic_tags: string[];
  is_fintech: boolean;
  search_text: string;
  priority_score: number;
  priority_reason: string;
}

export interface AppUpdateData {
  id: string;
  broker_code: string;
  broker_name: string;
  app_name: string;
  source_url: string;
  content_sha256: string;
  crawl_time: string;
  app_version: string;
  platform: string;
  publish_date: string;
  publish_timestamp: number | null;
  update_type: string;
  update_summary: string;
  feature_tags: string[];
  highlights: string[];
  processed_at: string;
  search_text: string;
}

export interface DashboardOverview {
  schema_version: string;
  generated_at: string;
  tender_projects: {
    record_count: number;
    broker_count: number;
    fintech_count: number;
    period: { from: string | null; to: string | null };
  };
  app_updates: {
    record_count: number;
    broker_count: number;
    app_count: number;
    period: { from: string | null; to: string | null };
  };
}

export interface DashboardFilters {
  schema_version: string;
  procurement: {
    brokers: string[];
    domains: string[];
    stages: string[];
    procurement_methods: string[];
    default_time_range: "30d" | "90d" | "year" | "all";
    default_fintech_only: boolean;
  };
  app_updates: {
    brokers: string[];
    apps: string[];
    update_types: string[];
    feature_tags: string[];
  };
}

export interface DashboardAiAnalysis {
  content: string | null;
  updated_at: string | null;
  meta: {
    generated_at?: string;
    source_count?: number;
    window_days?: number;
    cached?: boolean;
  } | null;
}

export type DashboardDatasetKey =
  | "overview"
  | "filters"
  | "tender_projects"
  | "app_updates"
  | "ai_analysis";
