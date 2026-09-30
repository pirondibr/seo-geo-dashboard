"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

type Client = { id: string; name: string; siteUrl: string; hosts: string[] };

type LatestJob = {
  id: string;
  modelKind: string;
  status: string;
  label: string;
  publicToken: string;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  internalHtmlPath?: string | null;
  clientHtmlPath?: string | null;
  phaseReports?: { fase1?: string; fase2?: string; fase3?: string };
  summary?: { hit: number; total: number; pct: number };
  costUsd?: number;
};

type LatestAi = {
  id: string;
  publicToken: string;
  keywordCount: number;
  sourceFileName: string;
  createdAt: string;
  htmlPath?: string | null;
};

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [latestJobs, setLatestJobs] = useState<LatestJob[]>([]);
  const [latestRunAt, setLatestRunAt] = useState<string | null>(null);
  const [latestAi, setLatestAi] = useState<LatestAi | null>(null);
  const [choice, setChoice] = useState<"gpt" | "gemini" | "both">("gpt");
  const [error, setError] = useState("");
  const [aiError, setAiError] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  async function loadClient() {
    const res = await fetch(`/api/clients/${id}`);
    if (!res.ok) return;
    const d = await res.json();
    setClient(d.client || null);
    setLatestJobs(d.latestJobs || []);
    setLatestRunAt(d.latestRunAt || null);
    setLatestAi(d.latestAiOverview || null);
  }

  useEffect(() => {
    let alive = true;
    async function load() {
      const res = await fetch(`/api/clients/${id}`);
      if (!res.ok) return;
      const d = await res.json();
      if (!alive) return;
      setClient(d.client || null);
      setLatestJobs(d.latestJobs || []);
      setLatestRunAt(d.latestRunAt || null);
      setLatestAi(d.latestAiOverview || null);
    }
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  async function startJob(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, choice }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Falha ao iniciar");
      return;
    }
    const first = data.jobs?.[0];
    if (first) router.push(`/agency/jobs/${first.id}`);
    else router.push("/agency");
  }

  async function uploadAiOverview(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setAiError("Selecione o arquivo Semrush (.xlsx)");
      return;
    }
    setAiLoading(true);
    setAiError("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/clients/${id}/aioverview`, { method: "POST", body: fd });
    const data = await res.json();
    setAiLoading(false);
    if (!res.ok) {
      setAiError(data.error || "Falha ao importar");
      return;
    }
    if (fileRef.current) fileRef.current.value = "";
    await loadClient();
  }

  if (!client) return <p className="muted">Carregando…</p>;

  return (
    <main>
      <p className="kicker">Cliente</p>
      <h1>{client.name}</h1>
      <p className="muted">
        <a href={client.siteUrl} target="_blank" rel="noreferrer">
          {client.siteUrl}
        </a>
        {" · "}
        {client.hosts.join(", ")}
      </p>

      <form className="card" onSubmit={startJob} style={{ marginTop: 20, maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Gerar relatório GEO</h2>
        <p className="muted">
          Rode primeiro o ChatGPT e depois o Gemini. As 3 fases de dados montam o relatório do cliente.
        </p>
        <div className="field">
          <label>Modelo</label>
          <div className="choice">
            <label>
              <input type="radio" name="choice" checked={choice === "gpt"} onChange={() => setChoice("gpt")} />
              ChatGPT
            </label>
            <label>
              <input type="radio" name="choice" checked={choice === "gemini"} onChange={() => setChoice("gemini")} />
              Gemini
            </label>
            <label>
              <input type="radio" name="choice" checked={choice === "both"} onChange={() => setChoice("both")} />
              Ambos
            </label>
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Iniciando…" : "Executar"}
          </button>
          <Link className="btn secondary" href="/agency">
            Voltar
          </Link>
        </div>

        <hr style={{ border: 0, borderTop: "1px solid #e2dbd0", margin: "22px 0 16px" }} />

        <h3 style={{ margin: "0 0 6px", fontSize: "1.05rem" }}>Última run GEO</h3>
        {!latestJobs.length ? (
          <p className="muted" style={{ margin: 0 }}>
            Ainda sem jobs GEO para este cliente.
          </p>
        ) : (
          <>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: "0.92rem" }}>
              {formatDateTime(latestRunAt)}
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              {latestJobs.map((j) => {
                const model = j.modelKind === "gpt" ? "ChatGPT" : "Gemini";
                const hasInternal = Boolean(j.internalHtmlPath || j.phaseReports?.fase1);
                const hasClient = j.status === "done" && Boolean(j.clientHtmlPath || j.publicToken);
                return (
                  <div
                    key={j.id}
                    style={{
                      background: "#faf8f4",
                      border: "1px solid #e2dbd0",
                      borderRadius: 12,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                      <strong>{model}</strong>
                      <span
                        className={`badge ${
                          j.status === "done"
                            ? "ok"
                            : j.status === "error" || j.status === "cancelled"
                              ? "err"
                              : j.status === "running"
                                ? "run"
                                : "queue"
                        }`}
                      >
                        {j.status === "cancelled" ? "parado" : j.status}
                      </span>
                      {j.summary ? (
                        <span className="muted" style={{ fontSize: "0.88rem" }}>
                          {j.summary.pct}% ({j.summary.hit}/{j.summary.total})
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: "0.88rem" }}>
                          {j.label}
                        </span>
                      )}
                    </div>
                    <div className="row-actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
                      {hasInternal ? (
                        <a
                          className="btn secondary"
                          href={`/api/reports/${j.id}?kind=internal`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Relatório interno
                        </a>
                      ) : (
                        <span className="muted" style={{ fontSize: "0.88rem" }}>
                          Interno ainda não pronto
                        </span>
                      )}
                      {hasClient ? (
                        <a className="btn secondary" href={`/r/${j.publicToken}`} target="_blank" rel="noreferrer">
                          Relatório cliente
                        </a>
                      ) : (
                        <span className="muted" style={{ fontSize: "0.88rem" }}>
                          Cliente: quando concluir
                        </span>
                      )}
                      <Link className="btn secondary" href={`/agency/jobs/${j.id}`}>
                        Ver job
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </form>

      <form className="card" onSubmit={uploadAiOverview} style={{ marginTop: 16, maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Relatório AI Overview</h2>
        <p className="muted">
          Importe o export Semrush Organic Positions (.xlsx). O sistema filtra as palavras com{" "}
          <strong>AI overview</strong> e gera o 3º relatório, com links para ChatGPT e Gemini no topo.
        </p>
        <div className="field">
          <label>Arquivo Semrush</label>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" />
        </div>
        {aiError ? <p className="error">{aiError}</p> : null}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={aiLoading}>
            {aiLoading ? "Importando…" : "Importar e gerar"}
          </button>
        </div>

        {latestAi ? (
          <>
            <hr style={{ border: 0, borderTop: "1px solid #e2dbd0", margin: "22px 0 16px" }} />
            <h3 style={{ margin: "0 0 6px", fontSize: "1.05rem" }}>Último AI Overview</h3>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: "0.92rem" }}>
              {formatDateTime(latestAi.createdAt)} · {latestAi.keywordCount.toLocaleString("pt-BR")} palavras ·{" "}
              {latestAi.sourceFileName}
            </p>
            <div className="row-actions">
              <a className="btn secondary" href={`/r/${latestAi.publicToken}`} target="_blank" rel="noreferrer">
                Abrir relatório AI Overview
              </a>
            </div>
          </>
        ) : null}
      </form>
    </main>
  );
}
