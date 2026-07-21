import { GoogleGenAI } from "@google/genai";

// Extração de cifras a partir de imagens de PDF, tentando provedores de IA em
// cascata: Gemini -> Cloudflare Workers AI -> Groq. Cada provedor só é tentado
// se o anterior falhar (por cota, chave ausente, ou qualquer outro erro) — o
// usuário só vê um erro se TODOS os provedores configurados falharem.

function cleanJsonText(text: string): string {
  let cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  // Modelos de raciocínio (ex.: qwen3.6 no Groq) podem devolver um bloco
  // <think>...</think> com o "pensamento" antes do JSON de verdade. Sem
  // remover isso, JSON.parse falha e a página inteira cai no modo de
  // rascunho bruto (era a causa do bug "Revisar título (extraído por IA
  // reserva)" aparecendo com o texto de raciocínio da IA no lugar da cifra).
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Se o bloco de raciocínio não foi fechado corretamente (ou o provedor só
  // emite a tag de fechamento), corta tudo antes do </think> também.
  cleaned = cleaned.replace(/^[\s\S]*<\/think>/i, "");
  return cleaned.trim();
}

// Sem isso, se um provedor (Gemini, Workers AI ou Groq) travar sem nunca
// responder — nem sucesso nem erro —, a cascata inteira fica parada nele para
// sempre, e o próximo provedor nunca chega a ser tentado.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: tempo limite de ${ms / 1000}s excedido`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// Normaliza a resposta de qualquer provedor para o formato que o cliente
// espera: um array de músicas. Provedores menores (Moondream, Groq) nem
// sempre devolvem JSON perfeito — em vez de descartar a página, guardamos o
// texto bruto como rascunho editável (o usuário já pode corrigir título e
// conteúdo na tela de revisão antes de salvar).
function safeParseSongs(rawText: string): any[] {
  const cleaned = cleanJsonText(rawText);
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.songs)) return parsed.songs;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {
    // segue para o fallback abaixo
  }
  if (!cleaned) return [];
  return [{
    title: "Revisar título (extraído por IA reserva)",
    artist: "",
    category: "",
    original_key: "",
    content: cleaned
  }];
}

async function runGemini(env: any, images: string[], prompt: string): Promise<any[]> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });

  const contents = [
    {
      role: "user",
      parts: [
        { text: prompt },
        ...images.map((img: string) => ({
          inlineData: { mimeType: "image/jpeg", data: img }
        }))
      ]
    }
  ];

  const response = await withTimeout(
    ai.models.generateContent({
      // gemini-2.5-flash-lite: modelo estável (não preview) com a maior cota gratuita
      // de RPM/RPD entre os modelos Gemini disponíveis, e otimizado para tarefas de
      // extração estruturada como esta.
      model: "gemini-2.5-flash-lite",
      contents,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    }),
    30000,
    "Gemini"
  );

  const text = response.text;
  if (!text) throw new Error("Gemini: resposta vazia");
  return safeParseSongs(text);
}

async function runCloudflareWorkersAI(env: any, images: string[], prompt: string): Promise<any[]> {
  if (!env.AI) throw new Error("Workers AI não está disponível (binding 'AI' ausente no projeto Cloudflare Pages)");

  // Moondream processa uma imagem por chamada (diferente do Gemini, que aceita
  // várias de uma vez), então processamos página a página e juntamos os
  // resultados. Isso significa que a fusão de uma música que continua na
  // próxima página (regra 1 do prompt) não é aplicada nesse provedor —
  // é o preço de ser a rede de segurança gratuita, ilimitada em chave, do app.
  const songs: any[] = [];
  for (const img of images) {
    const bytes = Uint8Array.from(atob(img), (c) => c.charCodeAt(0));
    const result: any = await withTimeout(
      env.AI.run('@cf/moondream/moondream3.1-9B-A2B', {
        task: 'query',
        image: [...bytes],
        prompt,
        max_tokens: 4096
      }),
      8000,
      "Cloudflare Workers AI"
    );
    const raw = result?.result ?? result?.response ?? result?.answer ?? '';
    songs.push(...safeParseSongs(String(raw)));
  }
  return songs;
}

async function runGroq(env: any, images: string[], prompt: string): Promise<any[]> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY não configurada");

  // O catálogo de modelos de visão do Groq muda com frequência (modelos são
  // descontinuados sem muito aviso). Se este parar de responder, confira o
  // modelo atual em https://console.groq.com/docs/vision e troque aqui.
  const model = "qwen/qwen3.6-27b";

  const content: any[] = [{ type: "text", text: prompt }];
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } });
  }

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
        messages: [{ role: "user", content }],
        temperature: 0.1,
        // Sem isso, o Qwen 3.6 "pensa em voz alta" e devolve um bloco
        // <think>...</think> antes do JSON, quebrando o parser (era a causa
        // raiz do bug em que o título extraído virava
        // "Revisar título (extraído por IA reserva)" com o raciocínio da IA
        // dentro do campo de conteúdo).
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
  return safeParseSongs(text);
}

export const onRequestPost = async (context: any) => {
  const { request, env } = context;
  try {
    const body: any = await request.json();
    const { images, prompt } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "Images are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const providers: { name: string; run: () => Promise<any[]> }[] = [
      { name: "Gemini", run: () => runGemini(env, images, prompt) },
      { name: "Cloudflare Workers AI", run: () => runCloudflareWorkersAI(env, images, prompt) },
      { name: "Groq", run: () => runGroq(env, images, prompt) },
    ];

    let lastError: any = null;
    for (const provider of providers) {
      try {
        const songs = await provider.run();
        return new Response(JSON.stringify(songs), {
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
      error: "Falha na extração por IA",
      details
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("AI Extraction error:", error);
    return new Response(JSON.stringify({
      error: "Falha na extração por IA",
      details: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
