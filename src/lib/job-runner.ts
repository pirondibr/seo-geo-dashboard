import { nanoid } from "nanoid";
import { waitUntil } from "@vercel/functions";
import { crawlBlogHints, crawlHomepage } from "./site";
import {
  extractRecursosFromHits,
  generateFase1Chunk,
  generateFase2Prompts,
  generateFase3Prompts,
  pickFase2Seeds,
} from "./prompts";
import { probePrompt } from "./probe";
import { mapPool } from "./openrouter";
import { getJob, saveJob, saveReportHtml } from "./store";
import { buildClientHtml, buildInternalHtml } from "./reports";
import { brandRoot, hostOf, isSocial, normalizeHost } from "./domain";
import type { JobLogLevel, JobRecord, ModelKind, ProbeResult } from "./types";
import { FX_BRL, MODELS } from "./types";

const BATCH = 4;
const CONCURRENCY = 4;
const MAX_LOGS = 200;

function slimJobForSave(job: JobRecord): JobRecord {
  return job;
}

function unlock(job: JobRecord) {
  job.lockedUntil = undefined;
}

async function continueJob(job: JobRecord, jobId: string) {
  unlock(job);
  await saveJob(slimJobForSave(job));
  await scheduleTick(jobId);
}

export function pushLog(job: JobRecord, message: string, level: JobLogLevel = "info") {
  if (!job.logs) job.logs = [];
  job.logs.push({ at: new Date().toISOString(), level, message });
  if (job.logs.length > MAX_LOGS) job.logs = job.logs.slice(-MAX_LOGS);
}

export async function createJobsForClient(opts: {
  clientId: string;
  clientName: string;
  siteUrl: string;
  hosts: string[];
  choice: "gpt" | "gemini" | "both";
}) {
  const kinds: ModelKind[] =
    opts.choice === "both" ? ["gpt", "gemini"] : [opts.choice];
  const jobs: JobRecord[] = [];
  const now = new Date().toISOString();
  for (const kind of kinds) {
    const job: JobRecord = {
      id: nanoid(10),
      clientId: opts.clientId,
      clientName: opts.clientName,
      siteUrl: opts.siteUrl,
      hosts: opts.hosts.map(normalizeHost),
      modelKind: kind,
      modelId: MODELS[kind],
      status: "queued",
      phase: "queued",
      label: "Na fila",
      done: 0,
      total: 0,
      costUsd: 0,
      publicToken: nanoid(16),
      createdAt: now,
      updatedAt: now,
      cursor: 0,
      resultsFase1: [],
      resultsFase2: [],
      resultsFase3: [],
      logs: [],
    };
    pushLog(job, `Job criado · ${kind === "gpt" ? "ChatGPT" : "Gemini"} · ${MODELS[kind]}`);
    pushLog(job, `Cliente ${opts.clientName} · ${opts.siteUrl}`);
    pushLog(job, `Hosts oficiais: ${job.hosts.join(", ") || "(nenhum ainda)"}`);
    await saveJob(job);
    jobs.push(job);
  }
  return jobs;
}

export async function scheduleTick(jobId: string) {
  const secret = process.env.JOB_SECRET || process.env.AUTH_SECRET || "dev-secret";
  const base =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:3000" : null);

  const runInline = () =>
    runTick(jobId).catch(async (e) => {
      console.error("tick error", e);
      try {
        const job = await getJob(jobId);
        if (job && job.status !== "done") {
          pushLog(job, `Worker falhou: ${e instanceof Error ? e.message : String(e)}`, "error");
          job.lockedUntil = undefined;
          await saveJob(job);
        }
      } catch {
        /* ignore */
      }
    });

  if (!base) {
    setTimeout(runInline, 50);
    return;
  }

  const origin = base.replace(/\/$/, "");
  const pending = fetch(`${origin}/api/jobs/${jobId}/tick`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  })
    .then(async (res) => {
      if (!res.ok) {
        console.error("scheduleTick HTTP", res.status, await res.text().catch(() => ""));
        await runInline();
      }
    })
    .catch(async (e) => {
      console.error("scheduleTick failed", e);
      await runInline();
    });

  try {
    waitUntil(pending);
  } catch {
    // outside Vercel runtime
    void pending;
  }
}

export async function runTick(jobId: string) {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job não encontrado");
  if (job.status === "done" || job.status === "error") return job;

  // prevent overlapping ticks
  if (job.lockedUntil && new Date(job.lockedUntil).getTime() > Date.now()) {
    return job;
  }
  job.lockedUntil = new Date(Date.now() + 90000).toISOString();
  await saveJob(slimJobForSave(job));

  try {
    job.status = "running";
    if (!job.startedAt) {
      job.startedAt = new Date().toISOString();
      pushLog(job, "Cronômetro iniciado");
    }

    if (job.phase === "queued") {
      pushLog(job, "Worker iniciado");
      job.phase = "crawl";
      job.label = "Lendo homepage…";
      pushLog(job, `Abrindo ${job.siteUrl}…`);
      await saveJob(slimJobForSave(job));
    }

    if (job.phase === "crawl") {
      if (!job.siteBrief) {
        job.label = "Lendo homepage…";
        pushLog(job, `Abrindo ${job.siteUrl}…`);
        await saveJob(slimJobForSave(job));
        const site = await crawlHomepage(job.siteUrl);
        if (!job.hosts.length) job.hosts = [site.host];
        else if (!job.hosts.includes(site.host)) job.hosts = [site.host, ...job.hosts];
        job.siteBrief = `${site.title}\n\n${site.text}`;
        job.blogTitles = await crawlBlogHints(job.siteUrl, site.host);
        pushLog(
          job,
          `Homepage ok · ${site.title.slice(0, 80)} · ${job.siteBrief.length} chars · ${job.blogTitles.length} assuntos de blog`,
          "ok"
        );
      }
      job.fase1GenStep = job.fase1GenStep || 0;
      job.promptsFase1 = job.promptsFase1 || [];
      job.phase = "generate_fase1";
      job.label = "Gerando prompts da fase 1…";
      pushLog(job, "Gerando prompts da fase 1 em 3 lotes (evita timeout)…");
      job.lockedUntil = undefined;
      await saveJob(slimJobForSave(job));
      await scheduleTick(jobId);
      return job;
    }

    if (job.phase === "generate_fase1") {
      const step = job.fase1GenStep || 0;
      if (step >= 3) {
        // already complete
      } else {
        pushLog(job, `Gerando lote ${step + 1}/3 da fase 1…`);
        await saveJob(slimJobForSave(job));
        const part = await generateFase1Chunk({
          modelId: job.modelId,
          clientName: job.clientName,
          siteUrl: job.siteUrl,
          host: job.hosts[0],
          siteBrief: job.siteBrief || "",
          blogTitles: job.blogTitles || [],
          step,
          startId: (job.promptsFase1?.length || 0) + 1,
        });
        job.promptsFase1 = [...(job.promptsFase1 || []), ...part.prompts];
        job.costUsd += part.cost;
        job.fase1GenStep = step + 1;
        pushLog(
          job,
          `Lote ${step + 1}/3 (${part.chunkName}): +${part.prompts.length} prompts · total ${job.promptsFase1.length} · US$ ${part.cost.toFixed(4)}`,
          "ok"
        );

        if (job.fase1GenStep < 3) {
          job.label = `Gerando prompts da fase 1… (${job.fase1GenStep}/3)`;
          job.lockedUntil = undefined;
          await saveJob(slimJobForSave(job));
          await scheduleTick(jobId);
          return job;
        }
      }

      const prompts = job.promptsFase1 || [];
      if (prompts.length < 40) {
        throw new Error(`Fase 1 ficou com só ${prompts.length} prompts`);
      }
      // renumber ids
      job.promptsFase1 = prompts.map((p, i) => ({ ...p, id: i + 1 }));
      job.phase = "fase1";
      job.cursor = 0;
      job.done = 0;
      job.total = job.promptsFase1.length;
      job.label = `Fase 1 · 0/${job.promptsFase1.length}`;
      job.resultsFase1 = [];
      pushLog(job, `Fase 1 pronta: ${job.promptsFase1.length} prompts`, "ok");
      pushLog(job, `Iniciando sondagens OpenRouter (lotes de ${BATCH}, concorrência ${CONCURRENCY})…`);
      job.lockedUntil = undefined;
      await saveJob(slimJobForSave(job));
      await scheduleTick(jobId);
      return job;
    }

    if (job.phase === "fase1") {
      await runProbeBatch(job, "fase1");
      if ((job.cursor || 0) < (job.promptsFase1 || []).length) {
        await continueJob(job, jobId);
        return job;
      }
      const hits = (job.resultsFase1 || []).filter((r) => r.site).length;
      pushLog(job, `Fase 1 concluída: ${hits}/${job.resultsFase1?.length || 0} acharam o site`, "ok");
      job.phase = "generate_fase2";
      job.label = "Montando fase 2…";
      pushLog(job, "Escolhendo seeds e gerando variações da fase 2…");
      await continueJob(job, jobId);
      return job;
    }

    if (job.phase === "generate_fase2") {
      const hits = (job.resultsFase1 || []).filter((r) => r.site);
      const seeds = pickFase2Seeds(hits);
      if (!seeds.length) {
        job.promptsFase2 = [];
        job.resultsFase2 = [];
        pushLog(job, "Nenhum seed na fase 1 · pulando fase 2", "warn");
        job.phase = "generate_fase3";
        job.label = "Sem seeds na fase 2 · indo para fase 3…";
        await continueJob(job, jobId);
        return job;
      }
      pushLog(job, `Seeds fase 2: ${seeds.map((s) => s.padrao).join(", ")}`);
      const gen = await generateFase2Prompts({ modelId: job.modelId, seeds });
      job.promptsFase2 = gen.prompts;
      job.costUsd += gen.cost;
      job.phase = "fase2";
      job.cursor = 0;
      job.done = 0;
      job.total = gen.prompts.length;
      job.label = `Fase 2 · 0/${gen.prompts.length}`;
      job.resultsFase2 = [];
      pushLog(job, `Fase 2: ${gen.prompts.length} variações geradas`, "ok");
      await continueJob(job, jobId);
      return job;
    }

    if (job.phase === "fase2") {
      await runProbeBatch(job, "fase2");
      if ((job.cursor || 0) < (job.promptsFase2 || []).length) {
        await continueJob(job, jobId);
        return job;
      }
      const hits = (job.resultsFase2 || []).filter((r) => r.site).length;
      pushLog(job, `Fase 2 concluída: ${hits}/${job.resultsFase2?.length || 0} acharam`, "ok");
      job.phase = "generate_fase3";
      job.label = "Montando fase 3…";
      pushLog(job, "Gerando situações da fase 3…");
      await continueJob(job, jobId);
      return job;
    }

    if (job.phase === "generate_fase3") {
      const hits = (job.resultsFase1 || []).filter((r) => r.site);
      let recursos = extractRecursosFromHits(hits);
      if (!recursos.length) {
        const from2 = [...new Set((job.resultsFase2 || []).map((r) => r.recurso || r.padrao).filter(Boolean))];
        recursos = from2.slice(0, 5).map((r) => ({ recurso: String(r), padrao: String(r) }));
      }
      if (!recursos.length) {
        job.promptsFase3 = [];
        job.resultsFase3 = [];
        pushLog(job, "Sem recursos para fase 3 · indo aos relatórios", "warn");
        job.phase = "build_reports";
        job.label = "Gerando relatórios…";
        await continueJob(job, jobId);
        return job;
      }
      // Cap recursos to keep generation under Vercel timeout
      recursos = recursos.slice(0, 4);
      pushLog(job, `Recursos fase 3 (${recursos.length}): ${recursos.map((r) => r.padrao).join(", ")}`);
      const avoid = [
        ...(job.promptsFase1 || []).map((p) => p.texto),
        ...(job.promptsFase2 || []).map((p) => p.texto),
      ];
      const gen = await generateFase3Prompts({
        modelId: job.modelId,
        recursos,
        avoidTexts: avoid,
      });
      job.promptsFase3 = gen.prompts;
      job.costUsd += gen.cost;
      job.phase = "fase3";
      job.cursor = 0;
      job.done = 0;
      job.total = gen.prompts.length;
      job.label = `Fase 3 · 0/${gen.prompts.length}`;
      job.resultsFase3 = [];
      pushLog(job, `Fase 3: ${gen.prompts.length} situações geradas`, "ok");
      await continueJob(job, jobId);
      return job;
    }

    if (job.phase === "fase3") {
      await runProbeBatch(job, "fase3");
      if ((job.cursor || 0) < (job.promptsFase3 || []).length) {
        await continueJob(job, jobId);
        return job;
      }
      const hits = (job.resultsFase3 || []).filter((r) => r.site).length;
      pushLog(job, `Fase 3 concluída: ${hits}/${job.resultsFase3?.length || 0} acharam`, "ok");
      job.phase = "build_reports";
      job.label = "Gerando relatórios…";
      pushLog(job, "Montando HTML interno e relatório do cliente…");
      await continueJob(job, jobId);
      return job;
    }

    if (job.phase === "build_reports") {
      const internal = buildInternalHtml(job);
      const client = buildClientHtml(job);
      const clientFixed = fixFormatAnswer(client);
      const iSaved = await saveReportHtml(job.id, "internal", internal);
      const cSaved = await saveReportHtml(job.id, "client", clientFixed);
      job.internalHtmlPath = iSaved.path;
      job.clientHtmlPath = cSaved.path;
      job.summary = summarize(job);
      job.phase = "done";
      job.status = "done";
      job.label = "Concluído";
      job.done = job.summary.total;
      job.total = job.summary.total;
      pushLog(
        job,
        `Concluído · ${job.summary.hit}/${job.summary.total} (${job.summary.pct}%) · custo US$ ${job.costUsd.toFixed(2)} · R$ ${(job.costUsd * FX_BRL).toFixed(2)}`,
        "ok"
      );
      unlock(job);
      await saveJob(slimJobForSave(job));
      return job;
    }

    pushLog(job, `Fase desconhecida: ${job.phase}`, "warn");
    unlock(job);
    await saveJob(slimJobForSave(job));
    return job;
  } catch (e) {
    job.status = "error";
    job.phase = "error";
    job.error = e instanceof Error ? e.message : String(e);
    job.label = "Erro";
    unlock(job);
    pushLog(job, `Erro: ${job.error}`, "error");
    await saveJob(slimJobForSave(job));
    return job;
  }
}

async function runProbeBatch(job: JobRecord, phase: "fase1" | "fase2" | "fase3") {
  const prompts =
    phase === "fase1"
      ? job.promptsFase1 || []
      : phase === "fase2"
        ? job.promptsFase2 || []
        : job.promptsFase3 || [];
  const resultsKey =
    phase === "fase1" ? "resultsFase1" : phase === "fase2" ? "resultsFase2" : "resultsFase3";

  // Source of truth = already saved results length (avoids cursor races)
  const existing = (job[resultsKey] as ProbeResult[]) || [];
  const cursor = existing.length;
  job.cursor = cursor;
  const slice = prompts.slice(cursor, cursor + BATCH);
  if (!slice.length) {
    job.done = cursor;
    job.total = prompts.length;
    return;
  }

  const from = cursor + 1;
  const to = cursor + slice.length;
  const labelPhase = phase === "fase1" ? "Fase 1" : phase === "fase2" ? "Fase 2" : "Fase 3";
  pushLog(job, `${labelPhase} · sondando ${from}–${to} de ${prompts.length}…`);

  const batchResults = await mapPool(slice, CONCURRENCY, (p) =>
    probePrompt({ prompt: p, modelId: job.modelId, hosts: job.hosts })
  );

  // Re-read before append to reduce overwrite races
  const fresh = await getJob(job.id);
  const freshResults = ((fresh?.[resultsKey] as ProbeResult[]) || existing) as ProbeResult[];
  if (freshResults.length > cursor) {
    // Another worker already advanced — adopt its state
    job[resultsKey] = freshResults as any;
    job.cursor = freshResults.length;
    job.done = freshResults.length;
    job.total = prompts.length;
    job.costUsd = Math.max(job.costUsd, fresh?.costUsd || 0);
    job.logs = fresh?.logs || job.logs;
    pushLog(job, `${labelPhase} · outro worker já avançou para ${freshResults.length}/${prompts.length}`, "warn");
    return;
  }

  job[resultsKey] = [...freshResults, ...batchResults] as any;
  job.costUsd += batchResults.reduce((s, r) => s + (r.cost || 0), 0);
  job.cursor = cursor + slice.length;
  job.done = job.cursor;
  job.total = prompts.length;
  job.label = `${labelPhase} · ${job.done}/${job.total}`;

  const hits = batchResults.filter((r) => r.site).length;
  const fails = batchResults.filter((r) => !r.ok).length;
  const batchCost = batchResults.reduce((s, r) => s + (r.cost || 0), 0);
  pushLog(
    job,
    `${labelPhase} · lote ${from}–${to}: ${hits} achou · ${fails ? fails + " erro · " : ""}US$ ${batchCost.toFixed(4)} · total ${job.done}/${job.total}`,
    hits ? "ok" : "info"
  );
}

function summarize(job: JobRecord) {
  const all = [...(job.resultsFase1 || []), ...(job.resultsFase2 || []), ...(job.resultsFase3 || [])];
  const hit = all.filter((r) => r.site).length;
  const total = all.length;
  const clientRoot = normalizeHost(job.hosts[0]);
  const brandMap = new Map<string, number>();
  for (const r of all) {
    const brands = new Set<string>();
    for (const c of r.citations || []) {
      const h = hostOf(c.url);
      if (!h || isSocial(h)) continue;
      brands.add(brandRoot(h, job.hosts));
    }
    if (r.site) brands.add(clientRoot);
    for (const b of brands) brandMap.set(b, (brandMap.get(b) || 0) + 1);
  }
  const ranking = [...brandMap.entries()].sort((a, b) => b[1] - a[1]);
  const comp = ranking.find(([root]) => root !== clientRoot);
  return {
    hit,
    total,
    pct: total ? Math.round((100 * hit) / total) : 0,
    competitor: comp
      ? {
          name: comp[0],
          root: comp[0],
          prompts: comp[1],
          pct: Math.round((100 * comp[1]) / total),
        }
      : undefined,
  };
}

function fixFormatAnswer(html: string) {
  return html.replace(
    /function formatAnswer\(text\) \{[\s\S]*?\n\}/,
    `function formatAnswer(text) {
  let t = esc(text || "");
  t = t.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|\\n)(?:- |\\* )(.+)/g, "$1• $2");
  const parts = t.split(/\\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "<p class='muted'>Sem texto.</p>";
  return parts.map((p) => "<p>" + p.replace(/\\n/g, "<br>") + "</p>").join("");
}`
  );
}
