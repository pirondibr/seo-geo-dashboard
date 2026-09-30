"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

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
};

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (alive) setJob(data.job);
    }
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  if (!job) return <p className="muted">Carregando…</p>;

  const clientLink = typeof window !== "undefined" ? `${window.location.origin}/r/${job.publicToken}` : `/r/${job.publicToken}`;
  const pct = job.total ? Math.round((100 * job.done) / job.total) : 0;

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
                {job.done}/{job.total} · US$ {job.costUsd.toFixed(2)}
              </p>
            </>
          ) : null}
          {job.error ? <p className="error">{job.error}</p> : null}
        </section>

        <section className="card">
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
        </section>
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
