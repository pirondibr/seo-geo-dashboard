export type ModelKind = "gpt" | "gemini";
export type ModelChoice = ModelKind | "both";

export type ClientRecord = {
  id: string;
  name: string;
  siteUrl: string;
  hosts: string[];
  notes?: string;
  createdAt: string;
};

export type JobPhase =
  | "queued"
  | "crawl"
  | "generate_fase1"
  | "fase1"
  | "generate_fase2"
  | "fase2"
  | "generate_fase3"
  | "fase3"
  | "build_reports"
  | "done"
  | "error";

export type JobLogLevel = "info" | "ok" | "warn" | "error";

export type JobLogEntry = {
  at: string;
  level: JobLogLevel;
  message: string;
};

export type PromptRow = {
  id: number;
  fase: 1 | 2 | 3;
  grupo?: string;
  padrao?: string;
  recurso?: string;
  modo?: "baixa" | "media";
  texto: string;
  tipo: "comercial" | "educacional";
};

export type ProbeResult = PromptRow & {
  model: string;
  ok: boolean;
  content: string;
  citations: { url: string; title: string }[];
  searches: number;
  searched: boolean;
  site: boolean;
  cost: number;
  error: string | null;
};

export type JobRecord = {
  id: string;
  clientId: string;
  clientName: string;
  siteUrl: string;
  hosts: string[];
  modelKind: ModelKind;
  modelId: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  phase: JobPhase;
  label: string;
  done: number;
  total: number;
  costUsd: number;
  publicToken: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  siteBrief?: string;
  blogTitles?: string[];
  promptsFase1?: PromptRow[];
  promptsFase2?: PromptRow[];
  promptsFase3?: PromptRow[];
  resultsFase1?: ProbeResult[];
  resultsFase2?: ProbeResult[];
  resultsFase3?: ProbeResult[];
  cursor?: number;
  summary?: {
    hit: number;
    total: number;
    pct: number;
    competitor?: { name: string; root: string; prompts: number; pct: number };
  };
  internalHtmlPath?: string;
  clientHtmlPath?: string;
  /** Paths to partial internal HTML snapshots (agency), filled as each phase finishes */
  phaseReports?: {
    fase1?: string;
    fase2?: string;
    fase3?: string;
  };
  logs?: JobLogEntry[];
  /** 0 = home lote A, 1 = home lote B, 2 = blog — geração fase 1 em pedaços */
  fase1GenStep?: number;
  /** Lease: only the owner may spend OpenRouter credits for this job */
  lockedUntil?: string;
  lockOwner?: string;
  /** Work reserved BEFORE any paid API call (prevents duplicate probes/gens) */
  claim?: {
    owner: string;
    phase: JobPhase | string;
    /** probe: result index range [from, to); gen: step number in `from` */
    from: number;
    to: number;
    at: string;
  };
  /** Cross-link to the sibling model report (GPT ↔ Gemini) for the same client */
  pairedReport?: {
    jobId: string;
    modelKind: ModelKind;
    publicToken: string;
  };
};

export const MODELS: Record<ModelKind, string> = {
  gpt: "openai/gpt-4o-mini",
  gemini: "google/gemini-2.5-flash-lite",
};

export const FX_BRL = 5.2204001;
