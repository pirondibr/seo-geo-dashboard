"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type Client = { id: string; name: string; siteUrl: string; hosts: string[] };

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [choice, setChoice] = useState<"gpt" | "gemini" | "both">("both");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then((r) => r.json())
      .then((d) => setClient(d.client || null));
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

      <form className="card" onSubmit={startJob} style={{ marginTop: 20, maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Gerar relatório</h2>
        <p className="muted">Roda as 3 fases de dados e monta o relatório do cliente automaticamente.</p>
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
      </form>
    </main>
  );
}
