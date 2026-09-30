"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type JobLog = { at: string; level: string; message: string };

type JobDetail = {
  id: string;
  clientName: string;
  siteUrl: string;
  hosts: string[];
  modelKind: string;
  modelId: string;
  status: string;
  phase: string;
  label: string;
  done: number;
  total: number;
  costUsd: number;
  publicToken: string;
  error?: string;
  summary?: { hit: number; total: number; pct: number; competitor?: { name: string; root: string; prompts: number; pct: number } };
  counts?: { f1: number; f2: number; f3: number; f1Hit: number; f2Hit: number; f3Hit: number };
  logs?: JobLog[];
  updatedAt?: string;
  createdAt?: string;
  startedAt?: string;
};

const FX_BRL = 5.2204001;

function formatClock(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Overall pipeline progress 0–100 for ETA. */
function pipelineProgress(job: JobDetail) {
  const ratio = job.total > 0 ? Math.min(1, job.done / job.total) : 0;
  switch (job.phase) {
    case "queued":
      return 0;
    case "crawl":
      return 3;
    case "generate_fase1":
      return 6;
    case "fase1":
      return 6 + 50 * ratio;
    case "generate_fase2":
      return 58;
    case "fase2":
      return 58 + 12 * ratio;
    case "generate_fase3":
      return 72;
    case "fase3":
      return 72 + 24 * ratio;
    case "build_reports":
      return 97;
    case "done":
      return 100;
    default:
      return Math.min(95, 10 + 40 * ratio);
  }
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [resuming, setResuming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const autoResumeTried = useRef(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (alive) setJob(data.job);
    }
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [job?.logs?.length]);

  useEffect(() => {
    if (!job || autoResumeTried.current) return;
    if (job.status === "done" || job.status === "error") return;
    const stale =
      job.status === "queued" ||
      ((job.logs?.length || 0) <= 3 &&
        Date.now() - new Date(job.updatedAt || job.logs?.[0]?.at || Date.now()).getTime() > 8000);
    if (!stale) return;
    autoResumeTried.current = true;
    fetch(`/api/jobs/${id}/resume`, { method: "POST" }).catch(() => {});
  }, [job, id]);

  const timing = useMemo(() => {
    if (!job) return null;
    const startIso = job.startedAt || job.createdAt;
    const startMs = startIso ? new Date(startIso).getTime() : now;
    const endMs = job.status === "done" || job.status === "error" ? new Date(job.updatedAt || now).getTime() : now;
    const elapsed = Math.max(0, endMs - startMs);
    const progress = pipelineProgress(job);
    const BASELINE_MS = 14 * 60 * 1000; // ~14 min typical one-model run

    let etaRemaining: number | null = null;
    let etaTotal: number | null = BASELINE_MS;

    if (job.status === "done") {
      etaRemaining = 0;
      etaTotal = elapsed;
    } else if (progress >= 8 && elapsed > 15000) {
      const projected = elapsed / (progress / 100);
      etaTotal = projected;
      etaRemaining = Math.max(0, projected - elapsed);
    } else {
      etaRemaining = Math.max(0, BASELINE_MS - elapsed);
      etaTotal = BASELINE_MS;
    }

    return { elapsed, etaRemaining, etaTotal, progress };
  }, [job, now]);

  async function resume() {
    setResuming(true);
    await fetch(`/api/jobs/${id}/resume`, { method: "POST" });
    setResuming(false);
  }

  if (!job) return <p className="muted">Carregando…</p>;

  const clientLink =
    typeof window !== "undefined" ? `${window.location.origin}/r/${job.publicToken}` : `/r/${job.publicToken}`;
  const pct = job.total ? Math.round((100 * job.done) / job.total) : 0;
  const logs = job.logs || [];

  return (
    <main>
      <p className="kicker">Job · {job.modelKind === "gpt" ? "ChatGPT" : "Gemini"}</p>
      <h1>{job.clientName}</h1>
      <p className="muted">
        {job.modelId} · {job.hosts.join(", ")}
      </p>

      <div className="grid two" style={{ marginTop: 18 }}>
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Status
          </p>
          <p style={{ fontSize: "1.4rem", margin: "8px 0" }}>
            <span
              className={`badge ${
                job.status === "done" ? "ok" : job.status === "error" ? "err" : job.status === "running" ? "run" : "queue"
              }`}
            >
              {job.status}
            </span>
          </p>
          <p className="muted">{job.label}</p>
          {job.total ? (
            <>
              <div className="progress">
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="muted">
                {job.done}/{job.total}
              </p>
            </>
          ) : null}
          <p style={{ margin: "10px 0 0", fontSize: "1.05rem" }}>
            <strong>Custo total:</strong> R$ {(job.costUsd * FX_BRL).toFixed(2).replace(".", ",")}
            <span className="muted" style={{ fontSize: "0.88rem" }}>
              {" "}
              (US$ {job.costUsd.toFixed(2).replace(".", ",")})
            </span>
          </p>
          {job.error ? <p className="error">{job.error}</p> : null}
          {job.status !== "done" ? (
            <div className="row-actions">
              <button className="btn secondary" type="button" onClick={resume} disabled={resuming}>
                {resuming ? "Retomando…" : "Retomar / forçar próximo passo"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Tempo
          </p>
          {timing ? (
            <>
              <p style={{ fontFamily: "Georgia, serif", fontSize: "2.2rem", margin: "8px 0 4px" }}>
                {formatDuration(timing.elapsed)}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                decorrido
              </p>
              <div style={{ marginTop: 14 }}>
                {job.status === "done" ? (
                  <p style={{ margin: 0 }}>
                    <strong>Total:</strong> {formatDuration(timing.elapsed)}
                  </p>
                ) : (
                  <>
                    <p style={{ margin: "0 0 4px" }}>
                      <strong>Restante estimado:</strong>{" "}
                      {timing.etaRemaining != null ? formatDuration(timing.etaRemaining) : "—"}
                    </p>
                    <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
                      Total estimado ~{formatDuration(timing.etaTotal || 0)} · pipeline {Math.round(timing.progress)}%
                    </p>
                    <div className="progress" style={{ marginTop: 10 }}>
                      <span style={{ width: `${Math.round(timing.progress)}%` }} />
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="muted">—</p>
          )}
        </section>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          Resultado
        </p>
        {job.summary ? (
          <>
            <p style={{ fontFamily: "Georgia, serif", fontSize: "2.4rem", margin: "8px 0" }}>{job.summary.pct}%</p>
            <p className="muted">
              {job.summary.hit} de {job.summary.total} acharam o site
            </p>
            {job.summary.competitor ? (
              <p className="muted">
                Top concorrente: {job.summary.competitor.root} ({job.summary.competitor.pct}%)
              </p>
            ) : null}
          </>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            {job.counts
              ? `F1 ${job.counts.f1Hit}/${job.counts.f1} · F2 ${job.counts.f2Hit}/${job.counts.f2} · F3 ${job.counts.f3Hit}/${job.counts.f3}`
              : "Aguardando…"}
          </p>
        )}
      </div>

      <h2>Log do processo</h2>
      <div className="card log-panel">
        {!logs.length ? (
          <p className="muted" style={{ margin: 0, padding: 18 }}>
            Ainda sem eventos. Se ficar parado, clique em Retomar.
          </p>
        ) : (
          <div className="log-list">
            {logs.map((line, i) => (
              <div key={`${line.at}-${i}`} className={`log-line log-${line.level || "info"}`}>
                <span className="log-time">{formatClock(line.at)}</span>
                <span className="log-msg">{line.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <h2>Links</h2>
      <div className="card">
        <p>
          <strong>Cliente (público):</strong>{" "}
          {job.status === "done" ? (
            <a href={clientLink} target="_blank" rel="noreferrer">
              {clientLink}
            </a>
          ) : (
            <span className="muted">Disponível quando o job terminar</span>
          )}
        </p>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Envie só este link ao cliente. O dashboard e o relatório interno ficam na agência.
        </p>
        <div className="row-actions">
          {job.status === "done" ? (
            <>
              <a className="btn" href={`/r/${job.publicToken}`} target="_blank" rel="noreferrer">
                Abrir relatório do cliente
              </a>
              <a className="btn secondary" href={`/api/reports/${job.id}?kind=internal`} target="_blank" rel="noreferrer">
                Relatório interno (agência)
              </a>
            </>
          ) : null}
          <Link className="btn secondary" href="/agency">
            Voltar
          </Link>
        </div>
      </div>
    </main>
  );
}
