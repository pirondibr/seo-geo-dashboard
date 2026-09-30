import * as XLSX from "xlsx";
import type { PairNav } from "./reports";
import { buildPairNavHtml } from "./reports";

export type AiOverviewKeyword = {
  keyword: string;
  position: number | null;
  volume: number | null;
  url: string | null;
  serpFeatures: string;
  positionType: string | null;
};

export type AiOverviewRecord = {
  id: string;
  clientId: string;
  clientName: string;
  siteUrl: string;
  publicToken: string;
  sourceFileName: string;
  createdAt: string;
  updatedAt: string;
  keywordCount: number;
  keywords: AiOverviewKeyword[];
  htmlPath?: string;
  pairedGpt?: { jobId: string; publicToken: string };
  pairedGemini?: { jobId: string; publicToken: string };
};

function esc(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cellStr(v: unknown) {
  if (v == null) return "";
  return String(v).trim();
}

function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasAiOverview(features: string) {
  return /ai\s*overview/i.test(features);
}

/** Parse Semrush Organic Positions export (xlsx or csv) → AI Overview keywords only. */
export function parseAiOverviewFile(buf: ArrayBuffer | Buffer, fileName: string): AiOverviewKeyword[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Planilha vazia");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (!rows.length) throw new Error("Arquivo sem linhas de dados");

  // Flexible header matching (Semrush may vary slightly)
  const keys = Object.keys(rows[0]);
  const findKey = (...cands: string[]) =>
    keys.find((k) => cands.some((c) => k.toLowerCase().replace(/\s+/g, " ") === c.toLowerCase())) ||
    keys.find((k) => cands.some((c) => k.toLowerCase().includes(c.toLowerCase())));

  const kKeyword = findKey("Keyword", "Palavra-chave", "Palavra chave");
  const kFeatures = findKey("SERP Features by Keyword", "SERP Features", "Features");
  const kPos = findKey("Position", "Posição", "Posicao");
  const kVol = findKey("Search Volume", "Volume", "Volume de busca");
  const kUrl = findKey("URL", "Url");
  const kType = findKey("Position Type", "Tipo de posição");

  if (!kKeyword) throw new Error("Coluna Keyword não encontrada no arquivo");
  if (!kFeatures) {
    throw new Error(
      `Coluna "SERP Features by Keyword" não encontrada. Colunas: ${keys.join(", ")}`
    );
  }

  const out: AiOverviewKeyword[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const features = cellStr(row[kFeatures]);
    if (!hasAiOverview(features)) continue;
    const keyword = cellStr(row[kKeyword]);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      keyword,
      position: kPos ? cellNum(row[kPos]) : null,
      volume: kVol ? cellNum(row[kVol]) : null,
      url: kUrl ? cellStr(row[kUrl]) || null : null,
      serpFeatures: features,
      positionType: kType ? cellStr(row[kType]) || null : null,
    });
  }

  // Sort by volume desc then keyword
  out.sort((a, b) => (b.volume || 0) - (a.volume || 0) || a.keyword.localeCompare(b.keyword, "pt"));

  if (!out.length) {
    throw new Error(
      `Nenhuma palavra com AI Overview encontrada em ${fileName}. Verifique o filtro/export do Semrush.`
    );
  }
  return out;
}

const PAIR_NAV_CSS = `.pair-nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.pair-link{display:inline-block;padding:8px 14px;border-radius:999px;border:1px solid #e2dbd0;background:#fff;color:#1a1814;text-decoration:none;font-size:.88rem}
.pair-link.on{background:#1a1814;color:#fff;border-color:#1a1814}
.pair-link:not(.on):hover{background:#faf7f1}`;

export function buildAiOverviewHtml(rec: AiOverviewRecord, pairNav?: PairNav | null) {
  const nav = buildPairNavHtml(pairNav);
  const date = new Date(rec.createdAt).toLocaleDateString("pt-BR");
  const perPage = 20;
  const totalPages = Math.max(1, Math.ceil(rec.keywords.length / perPage));
  const rows = rec.keywords
    .map(
      (k, i) =>
        `<tr data-page="${Math.floor(i / perPage) + 1}">
          <td class="num">${i + 1}</td>
          <td>${esc(k.keyword)}</td>
          <td class="num">${k.volume != null ? k.volume.toLocaleString("pt-BR") : "—"}</td>
          <td>${k.url ? `<a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.url.replace(/^https?:\/\//, "").slice(0, 48))}</a>` : "—"}</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(rec.clientName)} — AI Overview · Google</title>
<style>
:root{--bg:#f4f1ea;--paper:#fff;--ink:#1a1814;--muted:#6a635a;--line:#e2dbd0;--gold:#8a6a2f;--blue:#1a73e8;--blue-soft:#e8f0fe}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:radial-gradient(900px 420px at 12% -10%,#efe6d4 0%,transparent 55%),var(--bg);font-family:Segoe UI,system-ui,sans-serif;line-height:1.5}
.wrap{max-width:980px;margin:0 auto;padding:40px 22px 80px}
.kicker{margin:0 0 10px;color:var(--gold);font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0 0 10px;font-family:Georgia,serif;font-size:clamp(2rem,4.5vw,3rem);font-weight:500}
.lede{max-width:42rem;color:var(--muted);margin:0 0 28px}
.card{background:var(--blue-soft);border:1px solid #c5d7f5;border-radius:18px;padding:22px;max-width:320px}
.label{color:var(--muted);font-size:.86rem;margin:0 0 6px}
.big{font-family:Georgia,serif;font-size:clamp(2.6rem,5vw,3.8rem);line-height:.95;margin:0;color:var(--blue)}
h2{margin:42px 0 8px;font-family:Georgia,serif;font-size:1.55rem;font-weight:500}
.muted{color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:10px 0 8px;background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}
th,td{padding:11px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;font-size:.92rem}
th{color:var(--muted);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tbody tr{display:none}tbody tr.is-visible{display:table-row}
.pager{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 0}
.pager button{appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;padding:8px 14px;font:inherit;font-size:.88rem;cursor:pointer}
.pager button:disabled{opacity:.4;cursor:default}
.pager .info{color:var(--muted);font-size:.9rem}
a{color:var(--blue)}footer{margin-top:36px;color:var(--muted);font-size:.9rem}
${PAIR_NAV_CSS}
</style></head><body>
<div class="wrap">
${nav}
<p class="kicker">Google AI Overview · ${date}</p>
<h1>${esc(rec.clientName)}</h1>
<p class="lede">Palavras-chave do domínio em que o Google exibiu AI Overview (export Semrush Organic Positions).</p>
<section class="card">
  <p class="label">Palavras com AI Overview</p>
  <p class="big">${rec.keywordCount.toLocaleString("pt-BR")}</p>
</section>
<h2>Lista de palavras que aparecem no AI Overview</h2>
<p class="muted">${rec.keywordCount} termos · ordenados por volume de busca</p>
<table>
<thead><tr><th class="num">#</th><th>Palavra-chave</th><th class="num">Volume</th><th>URL</th></tr></thead>
<tbody id="kw-body">${rows}</tbody>
</table>
<nav class="pager" aria-label="Paginação" ${totalPages <= 1 ? 'hidden' : ""}>
  <button type="button" id="prev-page">Anterior</button>
  <span class="info" id="page-info">Página 1 de ${totalPages}</span>
  <button type="button" id="next-page">Próxima</button>
</nav>
<footer><p>Fonte: coluna “SERP Features by Keyword” contendo “AI overview”. Relatório gerado em ${esc(new Date(rec.createdAt).toLocaleString("pt-BR"))}.</p></footer>
</div>
<script>
(function () {
  var perPage = ${perPage};
  var totalPages = ${totalPages};
  var page = 1;
  var rows = Array.prototype.slice.call(document.querySelectorAll("#kw-body tr"));
  var prev = document.getElementById("prev-page");
  var next = document.getElementById("next-page");
  var info = document.getElementById("page-info");
  function render() {
    rows.forEach(function (tr) {
      var p = Number(tr.getAttribute("data-page"));
      if (p === page) tr.classList.add("is-visible");
      else tr.classList.remove("is-visible");
    });
    if (info) info.textContent = "Página " + page + " de " + totalPages;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  }
  if (prev) prev.addEventListener("click", function () { if (page > 1) { page--; render(); } });
  if (next) next.addEventListener("click", function () { if (page < totalPages) { page++; render(); } });
  render();
})();
</script>
</body></html>`;
}
