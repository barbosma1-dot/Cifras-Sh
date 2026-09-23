import { GoogleGenAI } from "@google/genai";

// Equivalente em TEXTO do extract-pdf.ts: usado pelo botão único
// "FORMATAR COM IA" do editor manual de cifras (ChordEditor.tsx). Recebe o
// texto colado pelo usuário e devolve título/artista/tom (quando
// identificáveis) + o conteúdo já convertido para ChordPro.
//
// Mesma estratégia de resiliência do extract-pdf.ts: tenta os provedores em
// cascata — Gemini (com rotação de chaves) -> Cloudflare Workers AI -> Groq —
// e só devolve erro pro usuário se TODOS falharem.

function cleanJsonText(text: string): string {
  let cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  // Modelos de raciocínio (ex.: qwen3.6 no Groq) podem devolver um bloco
  // <think>...</think> com o "pensamento" antes do JSON de verdade — sem
  // remover isso, JSON.parse falha e o editor cairia de volta pro
  // formatador local com o texto de raciocínio dentro do conteúdo.
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/^[\s\S]*<\/think>/i, "");
  return cleaned.trim();
}

// Sem isso, se um provedor travar sem nunca responder (nem sucesso nem
// erro), a cascata fica presa nele para sempre e o próximo provedor nunca
// chega a ser tentado.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: tempo limite de ${ms / 1000}s excedido`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// Normaliza a resposta de qualquer provedor para o objeto único que o
// cliente espera. Se o JSON vier malformado (comum em provedores menores),
// guarda o texto bruto como "content" — o usuário ainda pode revisar e
// corrigir na tela, em vez de perder a extração inteira.
function safeParseResult(rawText: string, originalContent: string): any {
  const cleaned = cleanJsonText(rawText);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      return {
        title: parsed.title || "",
        artist: parsed.artist || "",
        original_key: parsed.original_key || "",
        content: parsed.content || originalContent
      };
    }
  } catch {
    // segue para o fallback abaixo
  }
  return {
    title: "",
    artist: "",
    original_key: "",
    content: cleaned || originalContent
  };
}

// Lê todas as chaves Gemini configuradas, na ordem GEMINI_API_KEY,
// GEMINI_API_KEY_2 .. GEMINI_API_KEY_5. Só a primeira é obrigatória — as
// demais são opcionais, para juntar a cota gratuita de várias contas.
function getGeminiKeys(env: any): string[] {
  const keys: string[] = [];
  const candidates = [
    env.GEMINI_API_KEY,
    env.GEMINI_API_KEY_2,
    env.GEMINI_API_KEY_3,
    env.GEMINI_API_KEY_4,
    env.GEMINI_API_KEY_5
  ];
  for (const k of candidates) {
    if (k && typeof k === "string" && k.trim() && k !== "MY_GEMINI_API_KEY" && !k.includes("YOUR_API_KEY")) {
      keys.push(k.trim());
    }
  }
  return keys;
}

async function callGeminiWithKey(apiKey: string, prompt: string, content: string): Promise<any> {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });

  const response = await withTimeout(
    ai.models.generateContent({
      // Mesmo modelo "lite" usado no extract-pdf.ts: mais rápido, e o botão
      // "FORMATAR COM IA" deve ter a mesma velocidade percebida do fluxo de
      // importar PDF (era justamente a lentidão do modelo mais pesado, com
      // duas chamadas separadas, que motivou este endpoint).
      model: "gemini-3.1-flash-lite",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            artist: { type: "STRING" },
            original_key: { type: "STRING" },
            content: { type: "STRING" }
          },
          required: ["content"]
        },
        // Cifras longas (salmos, cânticos, hinos com várias estrofes)
        // podem gerar uma saída extensa em ChordPro — o mesmo teto usado no
        // extract-pdf.ts evita que o texto seja cortado no meio.
        maxOutputTokens: 65536
      }
    }),
    30000,
    "Gemini"
  );

  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new Error("Gemini: resposta cortada por limite de tokens (texto muito longo)");
  }

  const text = response.text;
  if (!text) throw new Error("Gemini: resposta vazia");
  return safeParseResult(text, content);
}

async function runGemini(env: any, prompt: string, content: string): Promise<any> {
  const keys = getGeminiKeys(env);
  if (keys.length === 0) throw new Error("GEMINI_API_KEY não configurada");

  let lastErr: any = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      return await callGeminiWithKey(keys[i], prompt, content);
    } catch (err: any) {
      lastErr = err;
      const isQuota = /quota|429|resource_exhausted|rate.?limit/i.test(err?.message || "");
      // Só passa pra próxima chave se o motivo foi cota/limite de taxa — se
      // for outro erro, tentar as outras chaves não resolve.
      if (isQuota && i < keys.length - 1) {
        console.error(`Gemini: chave #${i + 1} sem cota, tentando chave #${i + 2}...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function runCloudflareWorkersAI(env: any, prompt: string, content: string): Promise<any> {
  if (!env.AI) throw new Error("Workers AI não está disponível (binding 'AI' ausente no projeto Cloudflare Pages)");

  const result: any = await withTimeout(
    env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: "system", content: "Responda APENAS com o JSON pedido, sem nenhum texto antes ou depois." },
        { role: "user", content: prompt }
      ],
      max_tokens: 4096
    }),
    15000,
    "Cloudflare Workers AI"
  );

  const raw = result?.response ?? '';
  return safeParseResult(String(raw), content);
}

async function runGroq(env: any, prompt: string, content: string): Promise<any> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY não configurada");

  // Mesmo modelo usado no extract-pdf.ts. O catálogo de modelos do Groq muda
  // com frequência — se este parar de responder, confira o modelo atual em
  // https://console.groq.com/docs/models e troque aqui.
  const model = "qwen/qwen3.6-27b";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  let res: Response;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        // Sem isso, o Qwen "pensa em voz alta" num bloco <think> antes do
        // JSON — cleanJsonText já remove, mas evitar já ajuda a caber no
        // limite de tokens.
        reasoning_effort: "none"
      }),
      signal: controller.signal
    });
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("Groq: tempo limite de 20s excedido");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err: any = new Error(`Groq (${res.status}): ${errText || "erro desconhecido"}`);
    err.status = res.status;
    throw err;
  }

  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq: resposta vazia");
  return safeParseResult(text, content);
}

export const onRequestPost = async (context: any) => {
  const { request, env } = context;
  try {
    const body: any = await request.json();
    const { content, prompt } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return new Response(JSON.stringify({ error: "Conteúdo é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Prompt é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const providers: { name: string; run: () => Promise<any> }[] = [
      { name: "Gemini", run: () => runGemini(env, prompt, content) },
      { name: "Cloudflare Workers AI", run: () => runCloudflareWorkersAI(env, prompt, content) },
      { name: "Groq", run: () => runGroq(env, prompt, content) },
    ];

    let lastError: any = null;
    for (const provider of providers) {
      try {
        const result = await provider.run();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json", "X-AI-Provider": provider.name }
        });
      } catch (err: any) {
        console.error(`Provedor "${provider.name}" falhou, tentando o próximo:`, err.message);
        lastError = err;
        continue;
      }
    }

    // Todos os provedores configurados falharam.
    let details = lastError?.message || "Falha desconhecida";
    if (/quota|429|resource_exhausted|rate.?limit/i.test(details)) {
      details = "Limite de uso gratuito de todas as IAs configuradas foi excedido. Aguarde alguns minutos (ou até amanhã, se for cota diária) antes de tentar novamente.";
    }
    return new Response(JSON.stringify({
      error: "Falha na formatação por IA",
      details
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Text Extraction error:", error);
    return new Response(JSON.stringify({
      error: "Falha na formatação por IA",
      details: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
