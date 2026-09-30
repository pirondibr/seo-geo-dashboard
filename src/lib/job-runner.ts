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
import {
  getJob,
  saveJob,
  saveReportHtml,
  tryAcquireJobLock,
  renewJobLock,
  releaseJobLock,
  hasActiveJobLock,
  type JobLockHandle,
} from "./store";
import { buildClientHtml, buildInternalHtml } from "./reports";
import { brandRoot, hostOf, isSocial, normalizeHost } from "./domain";
import type { JobLogLevel, JobRecord, ModelKind, ProbeResult } from "./types";
import { FX_BRL, MODELS } from "./types";

const BATCH = 2;
/** Parallel OpenRouter probes inside one worker (not multiple workers — that double-bills). */
const CONCURRENCY = 2;
/** How many probe batches to try in one Vercel invocation before yielding. */
const MAX_BATCHES_PER_TICK = 6;
/** Leave headroom under maxDuration=60s for save/claim overhead. */
const TICK_PROBE_BUDGET_MS = 48_000;
const MAX_LOGS = 200;
const LOCK_MS = 75_000;
const CLAIM_VERIFY_ATTEMPTS = 8;
const CLAIM_VERIFY_BASE_MS = 100;

export type TickResult = {
  job: JobRecord;
  busy?: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function clearLeaseFields(job: JobRecord) {
  job.lockedUntil = undefined;
  job.lockOwner = undefined;
  job.claim = undefined;
}

function stampLease(job: JobRecord, lock: JobLockHandle) {
  job.lockOwner = lock.owner;
  job.lockedUntil = new Date(lock.until).toISOString();
}

async function continueJob(job: JobRecord, jobId: string, lock: JobLockHandle) {
  // Honor cancel that landed while we were working
  const latest = await getJob(jobId);
  if (latest?.status === "cancelled") {
    clearLeaseFields(latest);
    await saveJob(latest);
    await releaseJobLock(lock);
    return;
  }
  job.claim = undefined;
  stampLease(job, { ...lock, until: Date.now() + 4_000 });
  await saveJob(job);
  await releaseJobLock(lock);
  await scheduleTick(jobId);
}

/** Snapshot HTML interno assim que uma fase de sondagem termina. */
async function persistPhaseReport(job: JobRecord, through: 1 | 2 | 3) {
  const key = through === 1 ? "fase1" : through === 2 ? "fase2" : "fase3";
  const html = buildInternalHtml(job, { through, draft: true });
  const saved = await saveReportHtml(job.id, "internal", html, {
    suffix: `${key}-${Date.now()}`,
  });
  job.phaseReports = { ...(job.phaseReports || {}), [key]: saved.path };
  job.internalHtmlPath = saved.path;
  pushLog(job, `Relatório interno parcial (fase ${through}) pronto · abrir nos Links`, "ok");
}

/** Used by cancel route — snapshot with whatever phases finished. */
export async function buildInternalSnapshotOnCancel(job: JobRecord) {
  const through: 1 | 2 | 3 =
    (job.resultsFase3?.length || 0) > 0 ? 3 : (job.resultsFase2?.length || 0) > 0 ? 2 : 1;
  if (!(job.resultsFase1?.length || 0) && !(job.resultsFase2?.length || 0) && !(job.resultsFase3?.length || 0)) {
    return;
  }
  const html = buildInternalHtml(job, { through, draft: true });
  const saved = await saveReportHtml(job.id, "internal", html, {
    suffix: `cancelled-${Date.now()}`,
  });
  job.internalHtmlPath = saved.path;
  pushLog(job, `Snapshot interno salvo ao parar (até fase ${through})`, "ok");
}

async function claimWork(
  job: JobRecord,
  lock: JobLockHandle,
  phase: string,
  from: number,
  to: number
): Promise<{ job: JobRecord; lock: JobLockHandle } | null> {
  const renewed = (await renewJobLock(lock, LOCK_MS)) || lock;
  stampLease(job, renewed);
  job.claim = { owner: renewed.owner, phase, from, to, at: new Date().toISOString() };
  await saveJob(job);

  for (let i = 0; i < CLAIM_VERIFY_ATTEMPTS; i++) {
    await sleep(CLAIM_VERIFY_BASE_MS + i * 70);
    const fresh = await getJob(job.id);
    if (!fresh) continue;
    if (
      fresh.claim?.owner === renewed.owner &&
      fresh.claim.phase === phase &&
      fresh.claim.from === from &&
      fresh.claim.to === to
    ) {
      return { job: fresh, lock: renewed };
    }
    if (fresh.claim && fresh.claim.owner !== renewed.owner) return null;
  }
  return null;
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
        if (job && job.status !== "done" && job.status !== "error") {
          pushLog(job, `Worker falhou: ${e instanceof Error ? e.message : String(e)}`, "error");
          clearLeaseFields(job);
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
      if (res.status === 409) return;
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
    void pending;
  }
}

export async function runTick(jobId: string): Promise<TickResult> {
  const current = await getJob(jobId);
  if (!current) throw new Error("Job não encontrado");
  if (current.status === "done" || current.status === "error" || current.status === "cancelled") {
    return { job: current };
  }

  if (await hasActiveJobLock(jobId)) {
    return { job: current, busy: true };
  }

  let lock = await tryAcquireJobLock(jobId, LOCK_MS);
  if (!lock) {
    const busyJob = (await getJob(jobId)) || current;
    return { job: busyJob, busy: true };
  }

  let job = (await getJob(jobId)) || current;
  if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
    await releaseJobLock(lock);
    return { job };
  }

  job.status = "running";
  stampLease(job, lock);
  await saveJob(job);

  try {
    if (!job.startedAt) {
      job.startedAt = new Date().toISOString();
      pushLog(job, "Cronômetro iniciado");
    }

    if (job.phase === "queued") {
      pushLog(job, "Worker iniciado");
      job.phase = "crawl";
      job.label = "Lendo homepage…";
      pushLog(job, `Abrindo ${job.siteUrl}…`);
      await saveJob(job);
    }

    if (job.phase === "crawl") {
      if (!job.siteBrief) {
        job.label = "Lendo homepage…";
        pushLog(job, `Abrindo ${job.siteUrl}…`);
        await saveJob(job);
        const site = await crawlHomepage(job.siteUrl);
        job = (await getJob(jobId)) || job;
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
      await continueJob(job, jobId, lock);
      return { job };
    }

    if (job.phase === "generate_fase1") {
      const step = job.fase1GenStep || 0;
      if (step < 3) {
        const claimed = await claimWork(job, lock, "generate_fase1", step, step + 1);
        if (!claimed) {
          await releaseJobLock(lock);
          return { job, busy: true };
        }
        job = claimed.job;
        const held = claimed.lock;

        if ((job.fase1GenStep || 0) > step) {
          await continueJob(job, jobId, held);
          return { job };
        }

        pushLog(job, `Gerando lote ${step + 1}/3 da fase 1…`);
        await saveJob(job);

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

        job = (await getJob(jobId)) || job;
        if (job.claim?.owner !== held.owner || job.claim.from !== step) {
          pushLog(job, `Lote fase 1 ${step + 1} descartado · claim perdida`, "warn");
          await releaseJobLock(held);
          return { job, busy: true };
        }
        if ((job.fase1GenStep || 0) === step) {
          job.promptsFase1 = [...(job.promptsFase1 || []), ...part.prompts];
          job.costUsd += part.cost;
          job.fase1GenStep = step + 1;
          pushLog(
            job,
            `Lote ${step + 1}/3 (${part.chunkName}): +${part.prompts.length} prompts · total ${job.promptsFase1.length} · US$ ${part.cost.toFixed(4)}`,
            "ok"
          );
        }

        if ((job.fase1GenStep || 0) < 3) {
          job.label = `Gerando prompts da fase 1… (${job.fase1GenStep}/3)`;
          await continueJob(job, jobId, held);
          return { job };
        }
        // fall through with held lock
        lock = held;
      }

      const prompts = job.promptsFase1 || [];
      if (prompts.length < 40) {
        throw new Error(`Fase 1 ficou com só ${prompts.length} prompts`);
      }
      job.promptsFase1 = prompts.map((p, i) => ({ ...p, id: i + 1 }));
      job.phase = "fase1";
      job.cursor = 0;
      job.done = 0;
      job.total = job.promptsFase1.length;
      job.label = `Fase 1 · 0/${job.promptsFase1.length}`;
      job.resultsFase1 = [];
      pushLog(job, `Fase 1 pronta: ${job.promptsFase1.length} prompts`, "ok");
      pushLog(job, `Iniciando sondagens OpenRouter (lotes de ${BATCH}, concorrência ${CONCURRENCY})…`);
      await continueJob(job, jobId, lock);
      return { job };
    }

    if (job.phase === "fase1") {
      const progressed = await runProbePhase(job, "fase1", lock);
      if (!progressed) {
        await releaseJobLock(lock);
        return { job, busy: true };
      }
      job = progressed.job;
      const held = progressed.lock;
      if (job.status === "cancelled") {
        await releaseJobLock(held);
        return { job };
      }
      if (!progressed.phaseDone) {
        await continueJob(job, jobId, held);
        return { job };
      }
      const hits = (job.resultsFase1 || []).filter((r) => r.site).length;
      pushLog(job, `Fase 1 concluída: ${hits}/${job.resultsFase1?.length || 0} acharam o site`, "ok");
      await persistPhaseReport(job, 1);
      job.phase = "generate_fase2";
      job.label = "Montando fase 2…";
      pushLog(job, "Escolhendo seeds e gerando variações da fase 2…");
      await continueJob(job, jobId, held);
      return { job };
    }

    if (job.phase === "generate_fase2") {
      if (job.promptsFase2 && job.promptsFase2.length > 0) {
        job.phase = "fase2";
        await continueJob(job, jobId, lock);
        return { job };
      }
      const hits = (job.resultsFase1 || []).filter((r) => r.site);
      const seeds = pickFase2Seeds(hits);
      if (!seeds.length) {
        job.promptsFase2 = [];
        job.resultsFase2 = [];
        pushLog(job, "Nenhum seed na fase 1 · pulando fase 2", "warn");
        job.phase = "generate_fase3";
        job.label = "Sem seeds na fase 2 · indo para fase 3…";
        await continueJob(job, jobId, lock);
        return { job };
      }

      const claimed = await claimWork(job, lock, "generate_fase2", 0, 1);
      if (!claimed) {
        await releaseJobLock(lock);
        return { job, busy: true };
      }
      job = claimed.job;
      const held = claimed.lock;
      if (job.promptsFase2 && job.promptsFase2.length > 0) {
        job.phase = "fase2";
        await continueJob(job, jobId, held);
        return { job };
      }

      pushLog(job, `Seeds fase 2: ${seeds.map((s) => s.padrao).join(", ")}`);
      const gen = await generateFase2Prompts({ modelId: job.modelId, seeds });
      job = (await getJob(jobId)) || job;
      if (job.claim?.owner !== held.owner) {
        pushLog(job, "Geração fase 2 descartada · claim perdida", "warn");
        await releaseJobLock(held);
        return { job, busy: true };
      }
      if (!job.promptsFase2?.length) {
        job.promptsFase2 = gen.prompts;
        job.costUsd += gen.cost;
        pushLog(job, `Fase 2: ${gen.prompts.length} variações geradas`, "ok");
      }
      job.phase = "fase2";
      job.cursor = 0;
      job.done = 0;
      job.total = job.promptsFase2.length;
      job.label = `Fase 2 · 0/${job.promptsFase2.length}`;
      job.resultsFase2 = job.resultsFase2 || [];
      await continueJob(job, jobId, held);
      return { job };
    }

    if (job.phase === "fase2") {
      const progressed = await runProbePhase(job, "fase2", lock);
      if (!progressed) {
        await releaseJobLock(lock);
        return { job, busy: true };
      }
      job = progressed.job;
      const held = progressed.lock;
      if (job.status === "cancelled") {
        await releaseJobLock(held);
        return { job };
      }
      if (!progressed.phaseDone) {
        await continueJob(job, jobId, held);
        return { job };
      }
      const hits = (job.resultsFase2 || []).filter((r) => r.site).length;
      pushLog(job, `Fase 2 concluída: ${hits}/${job.resultsFase2?.length || 0} acharam`, "ok");
      await persistPhaseReport(job, 2);
      job.phase = "generate_fase3";
      job.label = "Montando fase 3…";
      pushLog(job, "Gerando situações da fase 3…");
      await continueJob(job, jobId, held);
      return { job };
    }

    if (job.phase === "generate_fase3") {
      if (job.promptsFase3 && job.promptsFase3.length > 0) {
        job.phase = "fase3";
        await continueJob(job, jobId, lock);
        return { job };
      }
      const hits = (job.resultsFase1 || []).filter((r) => r.site);
      let recursos = extractRecursosFromHits(hits);
      if (!recursos.length) {
        const from2 = [
          ...new Set((job.resultsFase2 || []).map((r) => r.recurso || r.padrao).filter(Boolean)),
        ];
        recursos = from2.slice(0, 5).map((r) => ({ recurso: String(r), padrao: String(r) }));
      }
      if (!recursos.length) {
        job.promptsFase3 = [];
        job.resultsFase3 = [];
        pushLog(job, "Sem recursos para fase 3 · indo aos relatórios", "warn");
        job.phase = "build_reports";
        job.label = "Gerando relatórios…";
        await continueJob(job, jobId, lock);
        return { job };
      }
      recursos = recursos.slice(0, 4);

      const claimed = await claimWork(job, lock, "generate_fase3", 0, 1);
      if (!claimed) {
        await releaseJobLock(lock);
        return { job, busy: true };
      }
      job = claimed.job;
      const held = claimed.lock;
      if (job.promptsFase3 && job.promptsFase3.length > 0) {
        job.phase = "fase3";
        await continueJob(job, jobId, held);
        return { job };
      }

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
      job = (await getJob(jobId)) || job;
      if (job.claim?.owner !== held.owner) {
        pushLog(job, "Geração fase 3 descartada · claim perdida", "warn");
        await releaseJobLock(held);
        return { job, busy: true };
      }
      if (!job.promptsFase3?.length) {
        job.promptsFase3 = gen.prompts;
        job.costUsd += gen.cost;
        pushLog(job, `Fase 3: ${gen.prompts.length} situações geradas`, "ok");
      }
      job.phase = "fase3";
      job.cursor = 0;
      job.done = 0;
      job.total = job.promptsFase3.length;
      job.label = `Fase 3 · 0/${job.promptsFase3.length}`;
      job.resultsFase3 = job.resultsFase3 || [];
      await continueJob(job, jobId, held);
      return { job };
    }

    if (job.phase === "fase3") {
      const progressed = await runProbePhase(job, "fase3", lock);
      if (!progressed) {
        await releaseJobLock(lock);
        return { job, busy: true };
      }
      job = progressed.job;
      const held = progressed.lock;
      if (job.status === "cancelled") {
        await releaseJobLock(held);
        return { job };
      }
      if (!progressed.phaseDone) {
        await continueJob(job, jobId, held);
        return { job };
      }
      const hits = (job.resultsFase3 || []).filter((r) => r.site).length;
      pushLog(job, `Fase 3 concluída: ${hits}/${job.resultsFase3?.length || 0} acharam`, "ok");
      await persistPhaseReport(job, 3);
      job.phase = "build_reports";
      job.label = "Gerando relatórios…";
      pushLog(job, "Montando HTML interno e relatório do cliente…");
      await continueJob(job, jobId, held);
      return { job };
    }

    if (job.phase === "build_reports") {
      const claimed = await claimWork(job, lock, "build_reports", 0, 1);
      if (!claimed) {
        await releaseJobLock(lock);
        return { job, busy: true };
      }
      job = claimed.job;
      const held = claimed.lock;

      const internal = buildInternalHtml(job, { through: 3, draft: false });
      const client = buildClientHtml(job);
      const clientFixed = fixFormatAnswer(client);
      const iSaved = await saveReportHtml(job.id, "internal", internal, { suffix: `final-${Date.now()}` });
      const cSaved = await saveReportHtml(job.id, "client", clientFixed, { suffix: `final-${Date.now()}` });
      job.internalHtmlPath = iSaved.path;
      job.clientHtmlPath = cSaved.path;
      job.phaseReports = {
        ...(job.phaseReports || {}),
        fase1: job.phaseReports?.fase1,
        fase2: job.phaseReports?.fase2,
        fase3: job.phaseReports?.fase3 || iSaved.path,
      };
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
      clearLeaseFields(job);
      await saveJob(job);
      await releaseJobLock(held);
      return { job };
    }

    pushLog(job, `Fase desconhecida: ${job.phase}`, "warn");
    clearLeaseFields(job);
    await saveJob(job);
    await releaseJobLock(lock);
    return { job };
  } catch (e) {
    const latest = (await getJob(jobId)) || job;
    latest.status = "error";
    latest.phase = "error";
    latest.error = e instanceof Error ? e.message : String(e);
    latest.label = "Erro";
    clearLeaseFields(latest);
    pushLog(latest, `Erro: ${latest.error}`, "error");
    await saveJob(latest);
    await releaseJobLock(lock);
    return { job: latest };
  }
}

async function runProbePhase(
  job: JobRecord,
  phase: "fase1" | "fase2" | "fase3",
  lock: JobLockHandle
): Promise<{ job: JobRecord; lock: JobLockHandle; phaseDone: boolean } | null> {
  const promptsLen = () =>
    phase === "fase1"
      ? (job.promptsFase1 || []).length
      : phase === "fase2"
        ? (job.promptsFase2 || []).length
        : (job.promptsFase3 || []).length;

  const started = Date.now();
  let batches = 0;

  while (batches < MAX_BATCHES_PER_TICK && Date.now() - started < TICK_PROBE_BUDGET_MS) {
    const watch = await getJob(job.id);
    if (watch?.status === "cancelled") {
      return { job: watch, lock, phaseDone: true };
    }

    const before = job.cursor || 0;
    const total = promptsLen();
    if (before >= total) {
      return { job, lock, phaseDone: true };
    }

    const progressed = await runProbeBatch(job, phase, lock);
    if (!progressed) return null;
    job = progressed.job;
    lock = progressed.lock;
    batches++;

    if ((job.cursor || 0) >= promptsLen()) {
      return { job, lock, phaseDone: true };
    }
    // No progress (empty/skipped) — avoid tight loop
    if ((job.cursor || 0) <= before) {
      break;
    }
  }

  return { job, lock, phaseDone: (job.cursor || 0) >= promptsLen() };
}

async function runProbeBatch(
  job: JobRecord,
  phase: "fase1" | "fase2" | "fase3",
  lock: JobLockHandle
): Promise<{ job: JobRecord; lock: JobLockHandle } | null> {
  const prompts =
    phase === "fase1"
      ? job.promptsFase1 || []
      : phase === "fase2"
        ? job.promptsFase2 || []
        : job.promptsFase3 || [];
  const resultsKey =
    phase === "fase1" ? "resultsFase1" : phase === "fase2" ? "resultsFase2" : "resultsFase3";

  const existing = ((job[resultsKey] as ProbeResult[]) || []).length;
  const slice = prompts.slice(existing, existing + BATCH);
  if (!slice.length) {
    job.cursor = existing;
    job.done = existing;
    job.total = prompts.length;
    return { job, lock };
  }

  const from = existing;
  const to = existing + slice.length;
  const claimed = await claimWork(job, lock, phase, from, to);
  if (!claimed) return null;
  job = claimed.job;
  lock = claimed.lock;

  const afterClaimLen = ((job[resultsKey] as ProbeResult[]) || []).length;
  if (afterClaimLen !== from) {
    job.cursor = afterClaimLen;
    job.done = afterClaimLen;
    job.total = prompts.length;
    return { job, lock };
  }

  const labelPhase = phase === "fase1" ? "Fase 1" : phase === "fase2" ? "Fase 2" : "Fase 3";
  pushLog(job, `${labelPhase} · sondando ${from + 1}–${to} de ${prompts.length}…`);
  const renewed = (await renewJobLock(lock, LOCK_MS)) || lock;
  lock = renewed;
  stampLease(job, lock);
  await saveJob(job);

  const batchResults = await mapPool(slice, CONCURRENCY, (p) =>
    probePrompt({ prompt: p, modelId: job.modelId, hosts: job.hosts })
  );

  job = (await getJob(job.id)) || job;
  if (job.claim?.owner !== lock.owner || job.claim.from !== from) {
    pushLog(
      job,
      `${labelPhase} · lote ${from + 1}–${to} NÃO salvo · claim perdida (não duplicamos resultado)`,
      "warn"
    );
    return { job, lock };
  }

  const freshResults = ((job[resultsKey] as ProbeResult[]) || []) as ProbeResult[];
  if (freshResults.length !== from) {
    pushLog(
      job,
      `${labelPhase} · lote ${from + 1}–${to} descartado · resultados já em ${freshResults.length}`,
      "warn"
    );
    job.cursor = freshResults.length;
    job.done = freshResults.length;
    job.total = prompts.length;
    return { job, lock };
  }

  job[resultsKey] = [...freshResults, ...batchResults] as any;
  job.costUsd += batchResults.reduce((s, r) => s + (r.cost || 0), 0);
  job.cursor = to;
  job.done = to;
  job.total = prompts.length;
  job.label = `${labelPhase} · ${job.done}/${job.total}`;
  job.claim = undefined;

  const hits = batchResults.filter((r) => r.site).length;
  const fails = batchResults.filter((r) => !r.ok).length;
  const batchCost = batchResults.reduce((s, r) => s + (r.cost || 0), 0);
  pushLog(
    job,
    `${labelPhase} · lote ${from + 1}–${to}: ${hits} achou · ${fails ? fails + " erro · " : ""}US$ ${batchCost.toFixed(4)} · total ${job.done}/${job.total}`,
    hits ? "ok" : "info"
  );
  return { job, lock };
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
