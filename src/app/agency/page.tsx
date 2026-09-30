"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Client = { id: string; name: string; siteUrl: string; hosts: string[]; createdAt: string };
type Job = {
  id: string;
  clientId: string;
  clientName: string;
  modelKind: string;
  status: string;
  label: string;
  done: number;
  total: number;
  costUsd: number;
  publicToken: string;
  summary?: { hit: number; total: number; pct: number };
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
};

function formatDateTime(iso?: string) {
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

export default function AgencyHome() {
  const [clients, setClients] = useState<Client[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [c, j] = await Promise.all([fetch("/api/clients"), fetch("/api/jobs")]);
    if (c.ok) setClients((await c.json()).clients || []);
    if (j.ok) setJobs((await j.json()).jobs || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <main>
      <p className="kicker">Painel</p>
      <h1>Clientes e relatórios</h1>
      <p className="muted">Cadastre o site, escolha GPT, Gemini ou ambos, e acompanhe a geração.</p>

      <div className="row-actions">
        <Link className="btn" href="/agency/clients/new">
          Novo cliente
        </Link>
      </div>

      <h2>Clientes</h2>
      {loading ? <p className="muted">Carregando…</p> : null}
      {!loading && !clients.length ? <p className="muted">Nenhum cliente ainda.</p> : null}
      {clients.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Site</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    {c.hosts.join(", ")}
                  </div>
                </td>
                <td>
                  <a href={c.siteUrl} target="_blank" rel="noreferrer">
                    {c.siteUrl}
                  </a>
                </td>
                <td>
                  <Link href={`/agency/clients/${c.id}`}>Abrir</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>Jobs recentes</h2>
      {!jobs.length ? <p className="muted">Nenhum job ainda.</p> : null}
      {jobs.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Cliente</th>
              <th>Modelo</th>
              <th>Status</th>
              <th>Progresso</th>
              <th>Custo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: "0.9rem" }}>
                  {formatDateTime(j.startedAt || j.createdAt)}
                </td>
                <td>{j.clientName}</td>
                <td>{j.modelKind === "gpt" ? "ChatGPT" : "Gemini"}</td>
                <td>
                  <span
                    className={`badge ${
                      j.status === "done" ? "ok" : j.status === "error" ? "err" : j.status === "running" ? "run" : "queue"
                    }`}
                  >
                    {j.status}
                  </span>
                  <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
                    {j.label}
                    {j.error ? ` · ${j.error}` : ""}
                  </div>
                </td>
                <td>
                  {j.summary
                    ? `${j.summary.hit}/${j.summary.total} (${j.summary.pct}%)`
                    : j.total
                      ? `${j.done}/${j.total}`
                      : "—"}
                  {j.total && j.status === "running" ? (
                    <div className="progress">
                      <span style={{ width: `${Math.round((100 * j.done) / Math.max(j.total, 1))}%` }} />
                    </div>
                  ) : null}
                </td>
                <td>
                  {j.costUsd > 0 ? (
                    <>
                      R$ {(j.costUsd * 5.2204001).toFixed(2).replace(".", ",")}
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        US$ {j.costUsd.toFixed(2).replace(".", ",")}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <Link href={`/agency/jobs/${j.id}`}>Detalhe</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
