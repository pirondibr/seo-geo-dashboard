# GEO Dashboard

Painel da agência para gerar relatórios de visibilidade em IA (ChatGPT e Gemini via OpenRouter).

## O que faz

1. Cadastro de cliente (site + hosts oficiais)
2. Escolha: ChatGPT, Gemini ou ambos
3. Pipeline automático: crawl → 70 prompts → fases 1/2/3 → HTML interno + HTML do cliente
4. Link público `/r/{token}` só do relatório do cliente
5. Relatório interno e dashboard só com login da agência

## Variáveis de ambiente

Veja `.env.example`.

Na Vercel, obrigatório:

- `OPENROUTER_API_KEY`
- `AGENCY_PASSWORD`
- `AUTH_SECRET`
- `JOB_SECRET`
- `APP_URL` (URL do deploy, ex. `https://seu-app.vercel.app`)
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob — persistência entre invocações)

## Local

```bash
cp .env.example .env.local
# preencha a chave OpenRouter
npm install
npm run dev
```

Abra http://localhost:3000 — senha padrão do exemplo: `troque-esta-senha` (ou o valor de `AGENCY_PASSWORD`).

Sem Blob, os dados ficam em `.data/`.
