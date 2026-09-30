import { brandRoot, hostOf, hostMatchesOfficial, isSocial, normalizeHost } from "./domain";
import type { JobRecord, ProbeResult } from "./types";
import { FX_BRL } from "./types";
import { normalizeFase1Grupo } from "./prompts";

function esc(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pct(hit: number, total: number) {
  if (!total) return 0;
  return Math.round((100 * hit) / total);
}

function money(usd: number) {
  return {
    usd: `US$ ${usd.toFixed(2).replace(".", ",")}`,
    brl: `R$ ${(usd * FX_BRL).toFixed(2).replace(".", ",")}`,
  };
}

/** Top switcher linking ChatGPT ↔ Gemini reports. */
export type PairNav = {
  gpt: { href: string; current?: boolean };
  gemini: { href: string; current?: boolean };
};

export function buildPairNavHtml(nav: PairNav | null | undefined) {
  if (!nav?.gpt?.href || !nav?.gemini?.href) return "";
  const link = (label: string, href: string, on: boolean) =>
    on
      ? `<span class="pair-link on">${label}</span>`
      : `<a class="pair-link" href="${esc(href)}">${label}</a>`;
  return `<nav class="pair-nav" aria-label="Trocar modelo">
  ${link("Relatório ChatGPT", nav.gpt.href, Boolean(nav.gpt.current))}
  ${link("Relatório Gemini", nav.gemini.href, Boolean(nav.gemini.current))}
</nav>`;
}

const PAIR_NAV_CSS = `.pair-nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.pair-link{display:inline-block;padding:8px 14px;border-radius:999px;border:1px solid #e2dbd0;background:#fff;color:#1a1814;text-decoration:none;font-size:.88rem}
.pair-link.on{background:#1a1814;color:#fff;border-color:#1a1814}
.pair-link:not(.on):hover{background:#faf7f1}`;

export function buildInternalHtml(
  job: JobRecord,
  opts?: { through?: 1 | 2 | 3; draft?: boolean; pairNav?: PairNav | null }
) {
  const through = opts?.through ?? 3;
  const draft = opts?.draft ?? job.status !== "done";
  const pairNav = buildPairNavHtml(opts?.pairNav);
  const f1 = job.resultsFase1 || [];
  const f2 = through >= 2 ? job.resultsFase2 || [] : [];
  const f3 = through >= 3 ? job.resultsFase3 || [] : [];
  const all = [...f1, ...f2, ...f3];
  const hit = (rows: ProbeResult[]) => rows.filter((r) => r.site).length;
  const cost = (rows: ProbeResult[]) => rows.reduce((s, r) => s + (r.cost || 0), 0);
  const s1 = { hit: hit(f1), total: f1.length, pct: pct(hit(f1), f1.length), ...money(cost(f1)) };
  const s2 = { hit: hit(f2), total: f2.length, pct: pct(hit(f2), f2.length), ...money(cost(f2)) };
  const s3 = { hit: hit(f3), total: f3.length, pct: pct(hit(f3), f3.length), ...money(cost(f3)) };
  const sT = { hit: hit(all), total: all.length, pct: pct(hit(all), all.length), ...money(cost(all)) };

  const rows = (list: ProbeResult[]) =>
    list.length
      ? list
          .map((r) => {
            const tipo =
              r.fase === 1
                ? normalizeFase1Grupo(r.grupo || "categoria")
                : r.grupo || r.padrao || r.recurso || "—";
            return `<tr><td>${r.site ? "Achou" : r.ok === false ? "Erro" : "Não"}</td><td>${esc(tipo)}</td><td>${esc(r.texto)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="3" class="muted">Sem dados nesta fase ainda.</td></tr>`;

  const banner = draft
    ? `<p class="banner">Parcial · dados até a fase ${through}${job.status === "cancelled" ? " · job parado" : job.status === "running" ? " · job ainda rodando" : ""} · gerado ${esc(new Date().toLocaleString("pt-BR"))}</p>`
    : "";

  const navF2 = through >= 2 ? `<a href="#p2" onclick="show(2)">Fase 2</a>` : `<span class="nav-disabled">Fase 2</span>`;
  const navF3 = through >= 3 ? `<a href="#p3" onclick="show(3)">Fase 3</a>` : `<span class="nav-disabled">Fase 3</span>`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(job.clientName)} — Relatório interno · ${esc(job.modelKind)}${draft ? " (parcial)" : ""}</title>
<style>
body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#f4f1ea;color:#1a1814;line-height:1.45}
.wrap{max-width:980px;margin:0 auto;padding:32px 20px 64px}
h1{font-family:Georgia,serif;font-weight:500;font-size:2rem}
h2{font-family:Georgia,serif;font-weight:500;margin-top:2rem}
.muted{color:#6a635a}
.banner{background:#fff3cd;border:1px solid #e6d89a;border-radius:10px;padding:10px 14px;margin:12px 0 18px;font-size:.92rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.card{background:#fff;border:1px solid #e2dbd0;border-radius:14px;padding:14px}
.big{font-family:Georgia,serif;font-size:1.8rem;margin:0}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2dbd0;border-radius:12px;overflow:hidden;margin-top:10px}
th,td{padding:8px 10px;border-bottom:1px solid #e2dbd0;text-align:left;vertical-align:top;font-size:.92rem}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:#6a635a}
.nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 20px;align-items:center}
.nav a{padding:8px 12px;border-radius:999px;background:#fff;border:1px solid #e2dbd0;text-decoration:none;color:#1a1814;font-size:.85rem}
.nav-disabled{padding:8px 12px;border-radius:999px;background:#eee;border:1px solid #e2dbd0;color:#9a938a;font-size:.85rem}
.page{display:none}.page.on{display:block}
${PAIR_NAV_CSS}
</style></head><body>
<div class="wrap">
${pairNav}
<p class="muted">Relatório interno · ${esc(job.modelKind.toUpperCase())} · ${esc(job.modelId)} · agência</p>
<h1>${esc(job.clientName)}</h1>
<p class="muted">${esc(job.siteUrl)} · hosts: ${esc(job.hosts.join(", "))}</p>
${banner}
<div class="nav">
<a href="#p1" onclick="show(1)">Fase 1</a>
${navF2}
${navF3}
<a href="#p4" onclick="show(4)">Total</a>
</div>
<section class="page on" id="page1">
<h2>Fase 1</h2>
<div class="cards">
<div class="card"><p class="muted">Achou</p><p class="big">${s1.hit}/${s1.total}</p><p class="muted">${s1.pct}%</p></div>
<div class="card"><p class="muted">Custo</p><p class="big">${s1.usd}</p><p class="muted">${s1.brl}</p></div>
</div>
<table><thead><tr><th>Resultado</th><th>Tipo</th><th>Prompt</th></tr></thead><tbody>${rows(f1)}</tbody></table>
</section>
<section class="page" id="page2">
<h2>Fase 2</h2>
${
  through >= 2
    ? `<div class="cards">
<div class="card"><p class="muted">Achou</p><p class="big">${s2.hit}/${s2.total}</p><p class="muted">${s2.pct}%</p></div>
<div class="card"><p class="muted">Custo</p><p class="big">${s2.usd}</p><p class="muted">${s2.brl}</p></div>
</div>
<table><thead><tr><th>Resultado</th><th>Padrão</th><th>Prompt</th></tr></thead><tbody>${rows(f2)}</tbody></table>`
    : `<p class="muted">Fase 2 ainda não rodou.</p>`
}
</section>
<section class="page" id="page3">
<h2>Fase 3</h2>
${
  through >= 3
    ? `<div class="cards">
<div class="card"><p class="muted">Achou</p><p class="big">${s3.hit}/${s3.total}</p><p class="muted">${s3.pct}%</p></div>
<div class="card"><p class="muted">Custo</p><p class="big">${s3.usd}</p><p class="muted">${s3.brl}</p></div>
</div>
<table><thead><tr><th>Resultado</th><th>Recurso</th><th>Prompt</th></tr></thead><tbody>${rows(f3)}</tbody></table>`
    : `<p class="muted">Fase 3 ainda não rodou.</p>`
}
</section>
<section class="page" id="page4">
<h2>Total${draft ? " (parcial)" : ""}</h2>
<div class="cards">
<div class="card"><p class="muted">Achou</p><p class="big">${sT.hit}/${sT.total}</p><p class="muted">${sT.pct}%</p></div>
<div class="card"><p class="muted">Custo</p><p class="big">${sT.usd}</p><p class="muted">${sT.brl}</p></div>
<div class="card"><p class="muted">F1</p><p class="big">${s1.pct}%</p></div>
<div class="card"><p class="muted">F2</p><p class="big">${through >= 2 ? s2.pct + "%" : "—"}</p></div>
<div class="card"><p class="muted">F3</p><p class="big">${through >= 3 ? s3.pct + "%" : "—"}</p></div>
</div>
</section>
</div>
<script>
function show(n){document.querySelectorAll('.page').forEach((el,i)=>el.classList.toggle('on',i===n-1));}
</script>
</body></html>`;
}

const NAMES: Record<string, string> = {
  "apetsaude.com.br": "APet",
  "meupetclub.com.br": "Meu Pet Club",
  "petlove.com.br": "Petlove",
  "doglife.com.br": "Dog Life",
  "petunio.com.br": "Pet Unio",
  "maispetoficial.com.br": "+Pet",
  "phibo.com.br": "Phibo",
};

const grupoLabel: Record<string, string> = {
  categoria: "Geral",
  funcionalidade: "Funcionalidade",
  preço: "Preço",
  comparação: "Comparação",
  marca: "Marca",
  problema: "Problema",
  blog: "Blog",
};

export function buildClientHtml(job: JobRecord, opts?: { pairNav?: PairNav | null }) {
  const all = [...(job.resultsFase1 || []), ...(job.resultsFase2 || []), ...(job.resultsFase3 || [])];
  const clientRoot = normalizeHost(job.hosts[0]);
  const brandMap = new Map<string, { root: string; name: string; prompts: number }>();

  for (const r of all) {
    const brands = new Set<string>();
    for (const c of r.citations || []) {
      const h = hostOf(c.url);
      if (!h || isSocial(h)) continue;
      brands.add(brandRoot(h, job.hosts));
    }
    if (r.site) brands.add(clientRoot);
    for (const b of brands) {
      if (!brandMap.has(b)) {
        brandMap.set(b, { root: b, name: NAMES[b] || (b === clientRoot ? job.clientName : b), prompts: 0 });
      }
      brandMap.get(b)!.prompts++;
    }
  }

  const ranking = [...brandMap.values()].sort((a, b) => b.prompts - a.prompts || a.name.localeCompare(b.name, "pt"));
  const competitor = ranking.find((b) => b.root !== clientRoot) || {
    name: "—",
    root: "—",
    prompts: 0,
  };
  const total = all.length;
  const hits = all.filter((r) => r.site);
  const misses = all.filter((r) => !r.site);
  const hitPct = pct(hits.length, total);
  const compPct = pct(competitor.prompts, total);

  const mapRow = (r: ProbeResult) => ({
    id: r.id,
    grupo: r.grupo ? grupoLabel[r.grupo] || r.grupo : r.padrao || r.recurso || "—",
    texto: r.texto,
    content: r.content || "",
    cites: (r.citations || []).map((c) => {
      const host = hostOf(c.url);
      return {
        url: c.url,
        title: c.title || host,
        host,
        client: hostMatchesOfficial(host, job.hosts),
      };
    }),
  });

  const D = {
    all: { hit: hits.length, total, pct: hitPct },
    competitor: {
      name: competitor.name,
      root: competitor.root,
      prompts: competitor.prompts,
      pct: compPct,
    },
    ranking: ranking.slice(0, 25).map((b) => ({
      name: b.name,
      root: b.root,
      prompts: b.prompts,
      pct: pct(b.prompts, total),
      own: b.root === clientRoot,
    })),
    hits: hits.map(mapRow),
    misses: misses.map(mapRow),
  };

  const payload = JSON.stringify(D).replace(/</g, "\\u003c");
  const modelLabel = job.modelKind === "gpt" ? "ChatGPT" : "Gemini";
  const avatar = job.modelKind === "gpt" ? "AI" : "G";
  const avatarBg = job.modelKind === "gpt" ? "#10a37f" : "#1a73e8";
  const pairNav = buildPairNavHtml(opts?.pairNav);

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(job.clientName)} — Índice GEO · ${modelLabel}</title>
<style>
:root{--bg:#f4f1ea;--paper:#fff;--ink:#1a1814;--muted:#6a635a;--line:#e2dbd0;--green:#1b5e45;--green-soft:#e6f3ec;--gold:#8a6a2f;--comp:#3d4f7a;--comp-soft:#e8ecf5;--miss:#8d4038}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:radial-gradient(900px 420px at 12% -10%,#efe6d4 0%,transparent 55%),var(--bg);font-family:Segoe UI,system-ui,sans-serif;line-height:1.5}
.wrap{max-width:980px;margin:0 auto;padding:40px 22px 80px}
.kicker{margin:0 0 10px;color:var(--gold);font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0 0 10px;font-family:Georgia,serif;font-size:clamp(2rem,4.5vw,3rem);font-weight:500}
.lede{max-width:42rem;color:var(--muted);margin:0 0 28px}h2{margin:42px 0 8px;font-family:Georgia,serif;font-size:1.55rem;font-weight:500}
.muted{color:var(--muted)}.index{display:grid;grid-template-columns:1.1fr 1fr;gap:14px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:22px}
.card.own{background:var(--green-soft);border-color:#c9e2d4}.card.comp{background:var(--comp-soft);border-color:#cfd7ea}
.label{color:var(--muted);font-size:.86rem;margin:0 0 6px}
.big{font-family:Georgia,serif;font-size:clamp(2.6rem,5vw,3.8rem);line-height:.95;margin:0}
.card.own .big{color:var(--green)}.card.comp .big{color:var(--comp)}
.sub{margin:10px 0 0;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:10px 0 8px;background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}
th,td{padding:11px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}
tr.click{cursor:pointer}tr.click:hover td{background:#faf7f1}tr.click.selected td{background:#eef6f1}tr.own td{background:var(--green-soft)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.flag{display:inline-block;min-width:64px;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--green)}
.flag.miss{color:var(--miss)}.bar{height:8px;background:#ebe4d8;border-radius:99px;overflow:hidden;min-width:70px}.bar span{display:block;height:100%;background:var(--green)}.bar.comp span{background:var(--comp)}
.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:10px 0}
.pager button{background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:7px 14px;cursor:pointer;font:inherit}.pager button:disabled{opacity:.4}
.drawer-backdrop{position:fixed;inset:0;background:rgba(28,25,21,.28);opacity:0;pointer-events:none;transition:opacity .2s;z-index:40}
.drawer-backdrop.open{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;width:min(560px,100%);height:100%;background:#f7f7f8;border-left:1px solid #e5e5e5;transform:translateX(100%);transition:transform .22s;z-index:50;display:flex;flex-direction:column}
.drawer.open{transform:translateX(0)}.drawer-top{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:#fff;border-bottom:1px solid #ececec}
.drawer-close{border:1px solid #e5e5e5;background:#fff;border-radius:999px;width:36px;height:36px;cursor:pointer}
.drawer-scroll{flex:1;overflow:auto;padding:18px 16px 28px}
.chat-user{max-width:92%;margin:0 0 18px auto;padding:12px 14px;background:#ececf1;border-radius:18px}
.chat-ai{display:grid;grid-template-columns:32px 1fr;gap:12px}
.chat-avatar{width:32px;height:32px;border-radius:999px;background:${avatarBg};color:#fff;display:grid;place-items:center;font-size:.72rem;font-weight:700}
.chat-body{background:#fff;border:1px solid #ececec;border-radius:16px;padding:14px 16px}
.chat-sources{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px}
.chat-source{display:inline-flex;gap:8px;padding:8px 10px;border:1px solid #e5e5e5;border-radius:12px;background:#fafafa;text-decoration:none;color:#0d0d0d;font-size:.82rem}
.chat-source .dot{width:8px;height:8px;border-radius:99px;background:#9aa0a6}.chat-source.phibo .dot{background:${avatarBg}}
.chat-source .meta{display:flex;flex-direction:column;min-width:0}.chat-source .host{font-weight:600}.chat-source .title{color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
body.drawer-open{overflow:hidden}footer{margin-top:36px;color:var(--muted);font-size:.9rem}
${PAIR_NAV_CSS}
@media(max-width:720px){.index{grid-template-columns:1fr}.hide-m{display:none}}
</style></head><body>
<div class="wrap">
${pairNav}
<p class="kicker">Índice GEO · ${modelLabel} · ${new Date().toLocaleDateString("pt-BR")}</p>
<h1>${esc(job.clientName)} versus quem mais aparece</h1>
<p class="lede">Perguntas que um comprador faria. O índice compara ${esc(job.clientName)} com o concorrente que mais foi citado nessas respostas.</p>
<div class="index">
<section class="card own"><p class="label">${esc(job.clientName)}</p><p class="big">${hitPct}%</p><p class="sub"><strong>${hits.length} de ${total}</strong> respostas citaram um site oficial.</p></section>
<section class="card comp"><p class="label">Top 1 concorrente · ${esc(competitor.name)}</p><p class="big">${compPct}%</p><p class="sub"><strong>${competitor.prompts} de ${total}</strong> respostas citaram ${esc(competitor.root)}.</p></section>
</div>
<h2>Prompts em que ${esc(job.clientName)} apareceu</h2>
<p class="muted">${hits.length} respostas. Clique numa linha para abrir a conversa.</p>
<table id="hits"><thead><tr><th></th><th>Tipo</th><th>Prompt</th></tr></thead><tbody></tbody></table>
<div class="pager"><p class="muted" id="hits-page-label"></p><div class="btns"><button type="button" id="hits-prev">Anterior</button><button type="button" id="hits-next">Próxima</button></div></div>
<h2>Prompts em que ${esc(job.clientName)} não apareceu</h2>
<p class="muted">${misses.length} respostas. Clique numa linha para abrir a conversa.</p>
<table id="misses"><thead><tr><th></th><th>Tipo</th><th>Prompt</th></tr></thead><tbody></tbody></table>
<div class="pager"><p class="muted" id="misses-page-label"></p><div class="btns"><button type="button" id="misses-prev">Anterior</button><button type="button" id="misses-next">Próxima</button></div></div>
<h2>Empresas que mais apareceram</h2>
<p class="muted">Frequência nas ${total} perguntas. Redes sociais ficaram de fora.</p>
<table id="rank"><thead><tr><th>#</th><th>Empresa</th><th class="num">Prompts</th><th class="num">Índice</th><th class="hide-m"></th></tr></thead><tbody></tbody></table>
<div class="pager"><p class="muted" id="rank-page-label"></p><div class="btns"><button type="button" id="rank-prev">Anterior</button><button type="button" id="rank-next">Próxima</button></div></div>
<footer><p>Achou = host oficial na resposta ou nas citações. Ranking e top 1 usam as ${total} perguntas.</p></footer>
</div>
<div class="drawer-backdrop" id="chat-backdrop" hidden></div>
<aside class="drawer" id="chat-drawer" aria-hidden="true">
<div class="drawer-top"><strong>Resposta</strong><button type="button" class="drawer-close" id="chat-close" aria-label="Fechar">×</button></div>
<div class="drawer-scroll" id="chat-scroll"></div>
</aside>
<script>
const D = ${payload};
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c]));
function formatAnswer(text) {
  let t = esc(text || "");
  t = t.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|\\n)(?:- |\\* )(.+)/g, "$1• $2");
  const parts = t.split(/\\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "<p class='muted'>Sem texto.</p>";
  return parts.map((p) => "<p>" + p.replace(/\\n/g, "<br>") + "</p>").join("");
}
const drawer = document.getElementById("chat-drawer");
const backdrop = document.getElementById("chat-backdrop");
const chatScroll = document.getElementById("chat-scroll");
let selectedRow = null;
function closeChat(){drawer.classList.remove("open");backdrop.classList.remove("open");drawer.setAttribute("aria-hidden","true");backdrop.hidden=true;document.body.classList.remove("drawer-open");if(selectedRow)selectedRow.classList.remove("selected");selectedRow=null;}
function openChat(row,tr){if(selectedRow)selectedRow.classList.remove("selected");selectedRow=tr;tr.classList.add("selected");
const sources=(row.cites||[]).map((c)=>\`<a class="chat-source \${c.client?"phibo":""}" href="\${esc(c.url)}" target="_blank" rel="noopener"><span class="dot"></span><span class="meta"><span class="host">\${esc(c.host)}</span><span class="title">\${esc(c.title||c.host)}</span></span></a>\`).join("");
chatScroll.innerHTML=\`<div class="chat-user">\${esc(row.texto)}</div><div class="chat-ai"><div class="chat-avatar">${avatar}</div><div><div class="chat-body">\${formatAnswer(row.content)}</div>\${sources?\`<div class="chat-sources">\${sources}</div>\`:""}</div></div>\`;
chatScroll.scrollTop=0;backdrop.hidden=false;requestAnimationFrame(()=>{drawer.classList.add("open");backdrop.classList.add("open");});drawer.setAttribute("aria-hidden","false");document.body.classList.add("drawer-open");}
document.getElementById("chat-close").onclick=closeChat;backdrop.onclick=closeChat;document.addEventListener("keydown",(e)=>{if(e.key==="Escape")closeChat();});
function makePager(list,opts){let page=0;const body=document.querySelector(opts.body);const labelEl=document.getElementById(opts.label);const prev=document.getElementById(opts.prev);const next=document.getElementById(opts.next);const pages=Math.max(1,Math.ceil(list.length/opts.pageSize));
function render(){body.innerHTML="";closeChat();const start=page*opts.pageSize;list.slice(start,start+opts.pageSize).forEach((row)=>{const tr=document.createElement("tr");tr.className="click";tr.innerHTML=\`<td><span class="flag \${opts.flagClass||""}">\${opts.flagText}</span></td><td>\${esc(row.grupo)}</td><td>\${esc(row.texto)}</td>\`;body.appendChild(tr);tr.onclick=()=>openChat(row,tr);});const from=list.length?start+1:0;const to=Math.min(start+opts.pageSize,list.length);labelEl.textContent=from+"–"+to+" de "+list.length;prev.disabled=page<=0;next.disabled=page>=pages-1;}
prev.onclick=()=>{if(page>0){page--;render();}};next.onclick=()=>{if(page<pages-1){page++;render();}};render();}
makePager(D.hits,{pageSize:20,body:"#hits tbody",label:"hits-page-label",prev:"hits-prev",next:"hits-next",flagText:"Achou"});
makePager(D.misses,{pageSize:10,body:"#misses tbody",label:"misses-page-label",prev:"misses-prev",next:"misses-next",flagText:"Não achou",flagClass:"miss"});
const RANK_PAGE=10;let rankPage=0;const rankBody=document.querySelector("#rank tbody");const rankLabel=document.getElementById("rank-page-label");const rankPrev=document.getElementById("rank-prev");const rankNext=document.getElementById("rank-next");const rankPages=Math.max(1,Math.ceil(D.ranking.length/RANK_PAGE));const maxBar=D.ranking[0]?.prompts||1;
function renderRank(){rankBody.innerHTML="";const start=rankPage*RANK_PAGE;D.ranking.slice(start,start+RANK_PAGE).forEach((b,i)=>{const tr=document.createElement("tr");if(b.own)tr.className="own";tr.innerHTML=\`<td>\${start+i+1}</td><td>\${esc(b.name)}<br><span class="muted" style="font-size:.85rem">\${esc(b.root)}</span></td><td class="num">\${b.prompts}</td><td class="num">\${b.pct}%</td><td class="hide-m"><div class="bar \${b.own?"":"comp"}"><span style="width:\${Math.round((100*b.prompts)/maxBar)}%"></span></div></td>\`;rankBody.appendChild(tr);});const from=D.ranking.length?start+1:0;const to=Math.min(start+RANK_PAGE,D.ranking.length);rankLabel.textContent=from+"–"+to+" de "+D.ranking.length;rankPrev.disabled=rankPage<=0;rankNext.disabled=rankPage>=rankPages-1;}
rankPrev.onclick=()=>{if(rankPage>0){rankPage--;renderRank();}};rankNext.onclick=()=>{if(rankPage<rankPages-1){rankPage++;renderRank();}};renderRank();
</script></body></html>`;
}
