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

const FASE1_GRUPOS = [
  "categoria",
  "funcionalidade",
  "preço",
  "comparação",
  "marca",
  "problema",
  "blog",
] as const;

type Fase1Grupo = (typeof FASE1_GRUPOS)[number];

/** Gemini sometimes returns "categoria|funcionalidade|preço" — keep a single label. */
export function normalizeFase1Grupo(raw: string): Fase1Grupo {
  const aliases: Record<string, Fase1Grupo> = {
    categoria: "categoria",
    funcionalidade: "funcionalidade",
    preco: "preço",
    preço: "preço",
    comparacao: "comparação",
    comparação: "comparação",
    marca: "marca",
    problema: "problema",
    blog: "blog",
  };
  const parts = String(raw || "")
    .toLowerCase()
    .split(/[|/,+;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => aliases[s] || aliases[s.normalize("NFD").replace(/\p{M}/gu, "")] || null)
    .filter(Boolean) as Fase1Grupo[];

  // Prefer the most specific label when the model stacks several
  const priority: Fase1Grupo[] = [
    "marca",
    "blog",
    "comparação",
    "problema",
    "funcionalidade",
    "preço",
    "categoria",
  ];
  for (const p of priority) {
    if (parts.includes(p)) return p;
  }
  return "categoria";
}
  {
    name: "home A",
    minCount: 20,
    maxCount: 30,
    instruction: `Gere prompts dos grupos:
- categoria: 10
- funcionalidade: 15
- preço: 5
Total: 30 prompts.

PROIBIDO: citar o nome da marca do cliente, o domínio, ou qualquer variação (ex.: APet, Apet, apetsaude).
Escreva como quem ainda NÃO escolheu marca: "qual plano pet…", "me indica um plano…", "qual cobertura…".`,
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

Só no grupo "marca" pode aparecer o nome do cliente.
Em comparação e problema: PROIBIDO citar a marca ou o domínio. Em comparação use concorrentes genéricos do mercado, não o cliente.`,
  },
  {
    name: "blog",
    minCount: 15,
    maxCount: 20,
    instruction: `Gere 20 prompts do grupo "blog" (2 por assunto quando possível).
Perguntas comerciais sobre o assunto (qual plano, me indica, quanto custa), não "como funciona".
PROIBIDO: citar o nome da marca do cliente ou o domínio.`,
  },
];

function brandTokens(clientName: string, host: string) {
  const tokens = new Set<string>();
  const push = (s: string) => {
    const t = s.trim().toLowerCase();
    if (t.length >= 2) tokens.add(t);
  };
  push(clientName);
  push(clientName.replace(/\s+/g, ""));
  push(host);
  push(host.replace(/^www\./, ""));
  const root = host.split(".")[0] || "";
  push(root);
  // common variants: apetsaude -> apet
  if (root.length > 4) push(root.replace(/saude$/, "").replace(/health$/, ""));
  return [...tokens].filter(Boolean);
}

export function promptLeaksBrand(texto: string, clientName: string, host: string) {
  const t = texto.toLowerCase();
  return brandTokens(clientName, host).some((tok) => {
    if (tok.length <= 3) {
      // short tokens need word boundary
      return new RegExp(`(?:^|[^a-z0-9])${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i").test(t);
    }
    return t.includes(tok);
  });
}

/** Remove brand leaks outside grupo marca. Returns sanitized list. */
export function sanitizeFase1Prompts(
  prompts: PromptRow[],
  clientName: string,
  host: string
): PromptRow[] {
  const tokens = brandTokens(clientName, host).sort((a, b) => b.length - a.length);
  return prompts
    .map((p) => {
      const grupo = normalizeFase1Grupo(p.grupo || "categoria");
      if (grupo === "marca") return { ...p, grupo };
      let texto = p.texto;
      for (const tok of tokens) {
        const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        texto = texto.replace(new RegExp(escaped, "gi"), "");
      }
      texto = texto
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([?!,.;:])/g, "$1")
        .replace(/\bda\s+\?/gi, "?")
        .replace(/\bdo\s+\?/gi, "?")
        .replace(/\bde\s+\?/gi, "?")
        .replace(/\s+da\s+/gi, " ")
        .replace(/\s+do\s+/gi, " ")
        .replace(/\(\s*\)/g, "")
        .trim();
      // fix leftovers like "plano  pet" / "da ?"
      texto = texto.replace(/\s{2,}/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "");
      return { ...p, grupo, texto };
    })
    .filter((p) => p.texto.length >= 12)
    .filter((p) => p.grupo === "marca" || !promptLeaksBrand(p.texto, clientName, host));
}

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

  const allowBrand = opts.step === 1; // only home B has marca
  const system = `Você monta prompts de pesquisa GEO em português do Brasil.
Regras rígidas:
- Escreva como um comprador real falaria.
- Quase todos comerciais.
- Responda SÓ JSON válido, sem markdown.
- ${
    allowBrand
      ? `O nome da marca "${opts.clientName}" só pode aparecer em prompts com grupo "marca". Em comparação e problema é PROIBIDO.`
      : `NUNCA escreva o nome da marca "${opts.clientName}", nem o domínio "${opts.host}", nem variações. Pergunte pelo tipo de produto, não pela marca.`
  }`;

  const user = `${
    allowBrand
      ? `Marca do cliente (só para grupo marca): ${opts.clientName}\nHost: ${opts.host}\n`
      : `Nicho do mercado (NÃO é para citar como marca nos prompts): descreva produtos genéricos do setor.\n`
  }Site de referência (só para extrair recursos/preços, NÃO para citar a marca nos textos${allowBrand ? ", exceto grupo marca" : ""}): ${opts.siteUrl}

Trecho da homepage (contexto de oferta):
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

Exemplos do JEITO CERTO (sem marca):
- "Qual plano de saúde pet tem teleconsulta 24h?"
- "Me indica um plano pet com reembolso em qualquer clínica."
Exemplos do JEITO ERRADO:
- "Como funciona a teleconsulta da ${opts.clientName}?"
- "O que está incluso no plano ${opts.clientName}?"

JSON:
{"prompts":[{"grupo":"categoria","texto":"...","tipo":"comercial"}]}
O campo "grupo" deve ser EXATAMENTE UM destes valores (nunca combine com |): ${FASE1_GRUPOS.join(", ")}.
O campo "tipo" deve ser "comercial" ou "educacional".`;

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

  const raw: PromptRow[] = list.slice(0, chunk.maxCount).map((p: any, i: number) => ({
    id: opts.startId + i,
    fase: 1 as const,
    grupo: normalizeFase1Grupo(String(p.grupo || "categoria")),
    texto: String(p.texto || "").trim(),
    tipo: p.tipo === "educacional" ? "educacional" : "comercial",
  }));

  const prompts = sanitizeFase1Prompts(
    raw.filter((p) => p.texto),
    opts.clientName,
    opts.host
  );

  if (prompts.length < Math.min(chunk.minCount, 12)) {
    throw new Error(
      `Chunk ${chunk.name}: após remover vazamento de marca sobraram ${prompts.length} prompts (mín ${chunk.minCount})`
    );
  }

  return {
    prompts,
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
