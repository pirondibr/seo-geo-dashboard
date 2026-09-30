import { nanoid } from "nanoid";
import {
  getJob,
  saveJob,
  saveReportHtml,
  listJobs,
  getLatestAiOverviewForClient,
  saveAiOverview,
  getAiOverview,
} from "./store";
import {
  buildClientHtml,
  buildInternalHtml,
  buildClientPairNav,
  buildInternalPairNav,
} from "./reports";
import { buildAiOverviewHtml, type AiOverviewRecord } from "./aioverview";
import type { JobRecord } from "./types";

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

async function latestDoneJob(clientId: string, kind: "gpt" | "gemini") {
  const jobs = (await listJobs())
    .filter((j) => j.clientId === clientId && j.modelKind === kind && j.status === "done" && j.publicToken)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  if (!jobs[0]) return null;
  return (await getJob(jobs[0].id)) || jobs[0];
}

/** Rebuild GPT + Gemini + AI Overview HTML with cross-links when siblings exist. */
export async function syncCrossLinkedReports(clientId: string, opts?: { preferAi?: AiOverviewRecord | null }) {
  const gpt = await latestDoneJob(clientId, "gpt");
  const gemini = await latestDoneJob(clientId, "gemini");
  const aio = opts?.preferAi ?? (await getLatestAiOverviewForClient(clientId));

  const siblings = {
    gpt: gpt ? { publicToken: gpt.publicToken, jobId: gpt.id } : null,
    gemini: gemini ? { publicToken: gemini.publicToken, jobId: gemini.id } : null,
    aioverview: aio ? { publicToken: aio.publicToken } : null,
  };

  // Update AI Overview HTML
  if (aio) {
    if (gpt) aio.pairedGpt = { jobId: gpt.id, publicToken: gpt.publicToken };
    if (gemini) aio.pairedGemini = { jobId: gemini.id, publicToken: gemini.publicToken };
    const html = buildAiOverviewHtml(
      aio,
      buildClientPairNav({
        current: "aioverview",
        gpt: siblings.gpt,
        gemini: siblings.gemini,
        aioverview: siblings.aioverview,
      })
    );
    const saved = await saveReportHtml(aio.id, "client", html, { suffix: `aio-${Date.now()}` });
    aio.htmlPath = saved.path;
    await saveAiOverview(aio);
  }

  // Update GPT
  if (gpt) {
    if (gemini) {
      gpt.pairedReport = { jobId: gemini.id, modelKind: "gemini", publicToken: gemini.publicToken };
    }
    const client = fixFormatAnswer(
      buildClientHtml(gpt, {
        pairNav: buildClientPairNav({
          current: "gpt",
          gpt: siblings.gpt,
          gemini: siblings.gemini,
          aioverview: siblings.aioverview,
        }),
      })
    );
    const internal = buildInternalHtml(gpt, {
      through: 3,
      draft: false,
      pairNav: buildInternalPairNav({
        current: "gpt",
        gpt: siblings.gpt,
        gemini: siblings.gemini,
        aioverview: siblings.aioverview,
      }),
    });
    const c = await saveReportHtml(gpt.id, "client", client, { suffix: `paired-${Date.now()}` });
    const i = await saveReportHtml(gpt.id, "internal", internal, { suffix: `paired-${Date.now()}` });
    gpt.clientHtmlPath = c.path;
    gpt.internalHtmlPath = i.path;
    await saveJob(gpt);
  }

  // Update Gemini
  if (gemini) {
    if (gpt) {
      gemini.pairedReport = { jobId: gpt.id, modelKind: "gpt", publicToken: gpt.publicToken };
    }
    const client = fixFormatAnswer(
      buildClientHtml(gemini, {
        pairNav: buildClientPairNav({
          current: "gemini",
          gpt: siblings.gpt,
          gemini: siblings.gemini,
          aioverview: siblings.aioverview,
        }),
      })
    );
    const internal = buildInternalHtml(gemini, {
      through: 3,
      draft: false,
      pairNav: buildInternalPairNav({
        current: "gemini",
        gpt: siblings.gpt,
        gemini: siblings.gemini,
        aioverview: siblings.aioverview,
      }),
    });
    const c = await saveReportHtml(gemini.id, "client", client, { suffix: `paired-${Date.now()}` });
    const i = await saveReportHtml(gemini.id, "internal", internal, { suffix: `paired-${Date.now()}` });
    gemini.clientHtmlPath = c.path;
    gemini.internalHtmlPath = i.path;
    await saveJob(gemini);
  }

  return { gpt, gemini, aio };
}

export async function createAiOverviewFromUpload(opts: {
  clientId: string;
  clientName: string;
  siteUrl: string;
  fileName: string;
  fileBuf: Buffer;
}) {
  const { parseAiOverviewFile } = await import("./aioverview");
  const keywords = parseAiOverviewFile(opts.fileBuf, opts.fileName);
  const now = new Date().toISOString();
  const rec: AiOverviewRecord = {
    id: nanoid(10),
    clientId: opts.clientId,
    clientName: opts.clientName,
    siteUrl: opts.siteUrl,
    publicToken: nanoid(16),
    sourceFileName: opts.fileName,
    createdAt: now,
    updatedAt: now,
    keywordCount: keywords.length,
    keywords,
  };
  await saveAiOverview(rec);
  const synced = await syncCrossLinkedReports(opts.clientId, { preferAi: rec });
  return synced.aio || (await getAiOverview(rec.id));
}

/** Used by Gemini build_reports to attach GPT (+ AI Overview) links. */
export async function resolveReportSiblings(clientId: string, self?: JobRecord) {
  const gpt =
    self?.modelKind === "gpt"
      ? self
      : await latestDoneJob(clientId, "gpt");
  const gemini =
    self?.modelKind === "gemini"
      ? self
      : await latestDoneJob(clientId, "gemini");
  const aio = await getLatestAiOverviewForClient(clientId);
  return { gpt, gemini, aio };
}
