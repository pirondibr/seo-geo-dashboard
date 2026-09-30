import { chatCompletion } from "./openrouter";
import type { PromptRow } from "./types";

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("JSON não encontrado na geração de prompts");
  return JSON.parse(raw.slice(start, end + 1));
}

type GenChunk = {
  name: string;
  instruction: string;
  minCount: number;
  maxCount: number;
};

const FASE1_CHUNKS: GenChunk[] = [
  {
    name: "home A",
    minCount: 20,
    maxCount: 30,
    instruction: `Gere prompts dos grupos:
- categoria: 10
- funcionalidade: 15
- preço: 5
Total: 30 prompts.`,
  },
  {
    name: "home B",
    minCount: 15,
    maxCount: 20,
    instruction: `Gere prompts dos grupos:
- comparação: 5
- marca: 5
- problema: 10
Total: 20 prompts.
Nos 5 de marca pode citar o nome do cliente. Nos outros NÃO cite a marca nem o domínio.`,
  },
  {
    name: "blog",
    minCount: 15,
    maxCount: 20,
    instruction: `Gere 20 prompts do grupo "blog" (2 por assunto quando possível).
Perguntas comerciais sobre o assunto do post, não "como funciona".
NÃO cite a marca do cliente nem o domínio.`,
  },
];

export async function generateFase1Chunk(opts: {
  modelId: string;
  clientName: string;
  siteUrl: string;
  host: string;
  siteBrief: string;
  blogTitles: string[];
  step: number;
  startId: number;
}): Promise<{ prompts: PromptRow[]; cost: number; chunkName: string }> {
  const chunk = FASE1_CHUNKS[opts.step];
  if (!chunk) throw new Error(`Chunk fase 1 inválido: ${opts.step}`);

  const system = `Você monta prompts de pesquisa GEO em português do Brasil.
Regras:
- Escreva como um comprador real falaria.
- Quase todos comerciais. No máximo 1 educacional no grupo marca.
- Responda SÓ JSON válido, sem markdown.`;

  const user = `Cliente: ${opts.clientName}
Site: ${opts.siteUrl}
Host oficial: ${opts.host}

Trecho da homepage:
"""
${opts.siteBrief.slice(0, 4500)}
"""

${
  opts.step === 2
    ? `Assuntos de blog:\n${
        opts.blogTitles.length
          ? opts.blogTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")
          : "(sem blog — invente 10 assuntos do nicho e faça 2 prompts cada)"
      }`
    : ""
}

${chunk.instruction}

JSON:
{"prompts":[{"grupo":"categoria|funcionalidade|preço|comparação|marca|problema|blog","texto":"...","tipo":"comercial|educacional"}]}`;

  const res = await chatCompletion({
    model: opts.modelId,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    webSearch: false,
    temperature: 0.7,
    timeoutMs: 35000,
  });

  const parsed = extractJson(res.content);
  const list = Array.isArray(parsed.prompts) ? parsed.prompts : [];
  if (list.length < chunk.minCount) {
    throw new Error(`Chunk ${chunk.name} gerou só ${list.length} prompts (mín ${chunk.minCount})`);
  }

  const prompts: PromptRow[] = list.slice(0, chunk.maxCount).map((p: any, i: number) => ({
    id: opts.startId + i,
    fase: 1 as const,
    grupo: String(p.grupo || "categoria"),
    texto: String(p.texto || "").trim(),
    tipo: p.tipo === "educacional" ? "educacional" : "comercial",
  }));

  return {
    prompts: prompts.filter((p) => p.texto),
    cost: res.cost,
    chunkName: chunk.name,
  };
}

/** @deprecated use generateFase1Chunk in steps */
export async function generateFase1Prompts(opts: {
  modelId: string;
  clientName: string;
  siteUrl: string;
  host: string;
  siteBrief: string;
  blogTitles: string[];
}): Promise<{ prompts: PromptRow[]; cost: number }> {
  let all: PromptRow[] = [];
  let cost = 0;
  for (let step = 0; step < 3; step++) {
    const part = await generateFase1Chunk({ ...opts, step, startId: all.length + 1 });
    all = all.concat(part.prompts);
    cost += part.cost;
  }
  return { prompts: all.slice(0, 70), cost };
}

export async function generateFase2Prompts(opts: {
  modelId: string;
  seeds: { id: number; texto: string; recurso: string; padrao: string }[];
}): Promise<{ prompts: PromptRow[]; cost: number }> {
  const system = `Você cria variações de prompts GEO em português. Responda SÓ JSON.`;
  const user = `Para cada semente, crie 3 variações de duplicidade baixa (mude a situação, mantenha a palavra do recurso exatamente igual) e 2 de duplicidade média (troque só um pedaço pequeno: verbo ou "24 horas"↔"24h"). Não repita o prompt original.

Sementes:
${opts.seeds.map((s, i) => `${i + 1}. padrao=${s.padrao} | recurso="${s.recurso}" | texto=${s.texto}`).join("\n")}

JSON:
{
  "variacoes": [
    { "padrao": "...", "recurso": "...", "modo": "baixa"|"media", "texto": "..." }
  ]
}`;

  const res = await chatCompletion({
    model: opts.modelId,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    webSearch: false,
    temperature: 0.6,
    timeoutMs: 40000,
  });
  const parsed = extractJson(res.content);
  const list = Array.isArray(parsed.variacoes) ? parsed.variacoes : [];
  let id = 200;
  const prompts: PromptRow[] = list.map((p: any) => ({
    id: id++,
    fase: 2 as const,
    padrao: String(p.padrao || ""),
    recurso: String(p.recurso || ""),
    modo: p.modo === "media" ? "media" : "baixa",
    texto: String(p.texto || "").trim(),
    tipo: "comercial" as const,
  }));
  return { prompts: prompts.filter((p) => p.texto), cost: res.cost };
}

export async function generateFase3Prompts(opts: {
  modelId: string;
  recursos: { recurso: string; padrao: string }[];
  avoidTexts: string[];
}): Promise<{ prompts: PromptRow[]; cost: number }> {
  // Split into batches of 4 recursos to stay under timeout
  const batches: { recurso: string; padrao: string }[][] = [];
  for (let i = 0; i < opts.recursos.length; i += 4) {
    batches.push(opts.recursos.slice(i, i + 4));
  }

  let all: PromptRow[] = [];
  let cost = 0;
  let id = 300;

  for (const batch of batches) {
    const system = `Você cria situações novas de compra em português. A palavra do recurso deve aparecer escrita do mesmo jeito. Responda SÓ JSON.`;
    const user = `Para cada recurso, escreva cerca de 8 prompts comerciais com situações novas. Não use sinônimos do recurso. Não repita estas frases:
${opts.avoidTexts.slice(0, 25).map((t) => `- ${t}`).join("\n")}

Recursos:
${batch.map((r, i) => `${i + 1}. padrao=${r.padrao} | recurso="${r.recurso}"`).join("\n")}

JSON:
{"situacoes":[{"padrao":"...","recurso":"...","texto":"..."}]}`;

    const res = await chatCompletion({
      model: opts.modelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      webSearch: false,
      temperature: 0.7,
      timeoutMs: 40000,
    });
    const parsed = extractJson(res.content);
    const list = Array.isArray(parsed.situacoes) ? parsed.situacoes : [];
    for (const p of list) {
      const texto = String(p.texto || "").trim();
      if (!texto) continue;
      all.push({
        id: id++,
        fase: 3,
        padrao: String(p.padrao || ""),
        recurso: String(p.recurso || ""),
        texto,
        tipo: "comercial",
      });
    }
    cost += res.cost;
  }

  return { prompts: all, cost };
}

export function pickFase2Seeds(hits: { id: number; texto: string; grupo?: string }[]) {
  const seeds: { id: number; texto: string; recurso: string; padrao: string }[] = [];
  const used = new Set<string>();
  const skipGrupos = new Set(["marca", "categoria", "preço", "comparação"]);

  for (const h of hits) {
    if (seeds.length >= 5) break;
    if (
      h.grupo &&
      skipGrupos.has(h.grupo) &&
      hits.some((x) => x.grupo === "funcionalidade" || x.grupo === "problema" || x.grupo === "blog")
    ) {
      continue;
    }
    const recurso = guessRecurso(h.texto);
    const key = recurso.toLowerCase();
    if (!recurso || used.has(key)) continue;
    used.add(key);
    seeds.push({ id: h.id, texto: h.texto, recurso, padrao: titleCase(recurso) });
  }

  if (seeds.length < 5) {
    for (const h of hits) {
      if (seeds.length >= 5) break;
      const recurso = guessRecurso(h.texto);
      const key = recurso.toLowerCase();
      if (!recurso || used.has(key)) continue;
      used.add(key);
      seeds.push({ id: h.id, texto: h.texto, recurso, padrao: titleCase(recurso) });
    }
  }
  return seeds;
}

export function extractRecursosFromHits(hits: { texto: string; grupo?: string }[]) {
  const out: { recurso: string; padrao: string }[] = [];
  const used = new Set<string>();
  for (const h of hits) {
    if (h.grupo === "marca" || h.grupo === "categoria") continue;
    const recurso = guessRecurso(h.texto);
    const key = recurso.toLowerCase();
    if (!recurso || used.has(key)) continue;
    used.add(key);
    out.push({ recurso, padrao: titleCase(recurso) });
  }
  return out.slice(0, 12);
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function guessRecurso(texto: string) {
  const t = texto.toLowerCase();
  const candidates = [
    "teleconsulta",
    "reembolso",
    "transporte",
    "sorteio",
    "livre escolha",
    "qualquer clínica",
    "coparticipação",
    "internação",
    "fisioterapia",
    "consulta online",
    "assistência funeral",
    "whatsapp",
    "cartão fidelidade",
    "fidelidade digital",
    "nota fiscal",
    "markup",
    "bags delivery",
    "100% online",
    "consignada",
    "pós-venda",
  ];
  for (const c of candidates) {
    if (t.includes(c)) return c;
  }
  const m = texto.match(
    /(?:tem|com|oferece|inclui)\s+([a-záàâãéêíóôõúç0-9%]{3,}(?:\s+[a-záàâãéêíóôõúç0-9%]{2,}){0,2})/i
  );
  if (m) return m[1].trim();
  const words = texto
    .replace(/[?!.,;:]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4);
  return words[words.length - 1] || "benefício";
}
