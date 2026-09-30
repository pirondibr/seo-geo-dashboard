"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [hosts, setHosts] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, siteUrl, hosts }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Falha ao salvar");
      return;
    }
    router.push(`/agency/clients/${data.client.id}`);
  }

  return (
    <main>
      <p className="kicker">Novo</p>
      <h1>Cadastrar cliente</h1>
      <p className="muted">
        Informe o site e os hosts oficiais (subdomínio conta; nome parecido no meio do domínio não conta).
      </p>
      <form className="card" onSubmit={onSubmit} style={{ maxWidth: 560, marginTop: 18 }}>
        <div className="field">
          <label htmlFor="name">Nome</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="APet" />
        </div>
        <div className="field">
          <label htmlFor="site">Site</label>
          <input
            id="site"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            required
            placeholder="https://apetsaude.com.br"
          />
        </div>
        <div className="field">
          <label htmlFor="hosts">Hosts oficiais (vírgula)</label>
          <input
            id="hosts"
            value={hosts}
            onChange={(e) => setHosts(e.target.value)}
            placeholder="apetsaude.com.br"
          />
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 6 }}>
            Se vazio, usamos o host do site. Ex.: phibo.com.br, phibo.site, phibo.space
          </p>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Salvando…" : "Salvar"}
          </button>
          <Link className="btn secondary" href="/agency">
            Cancelar
          </Link>
        </div>
      </form>
    </main>
  );
}
