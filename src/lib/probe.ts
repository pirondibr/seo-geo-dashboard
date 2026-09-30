import { chatCompletion } from "./openrouter";
import { siteHit } from "./domain";
import type { ProbeResult, PromptRow } from "./types";

export async function probePrompt(opts: {
  prompt: PromptRow;
  modelId: string;
  hosts: string[];
}): Promise<ProbeResult> {
  try {
    const res = await chatCompletion({
      model: opts.modelId,
      messages: [{ role: "user", content: opts.prompt.texto }],
      webSearch: true,
      temperature: 0.2,
    });
    const blob =
      res.content +
      "\n" +
      res.citations.map((c) => `${c.url} ${c.title}`).join("\n");
    return {
      ...opts.prompt,
      model: opts.modelId,
      ok: true,
      content: res.content,
      citations: res.citations,
      searches: res.searches,
      searched: res.searched,
      site: siteHit(blob, opts.hosts),
      cost: res.cost,
      error: null,
    };
  } catch (e) {
    return {
      ...opts.prompt,
      model: opts.modelId,
      ok: false,
      content: "",
      citations: [],
      searches: 0,
      searched: false,
      site: false,
      cost: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
