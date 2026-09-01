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

// Lê todas as chaves Gemini configuradas, na ordem GEMINI_API_KEY,
// GEMINI_API_KEY_2, GEMINI_API_KEY_3, GEMINI_API_KEY_4, GEMINI_API_KEY_5.
// Só a primeira é obrigatória — as demais são opcionais, para quem quiser
// juntar a cota gratuita de várias contas Google diferentes.
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

async function callGeminiWithKey(apiKey: string, images: string[], prompt: string): Promise<any[]> {
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
      // gemini-3.1-flash (não "flash-lite"): trocado de volta do "flash-lite" porque a
      // versão lite vinha resumindo/pulando versículos em salmos e cânticos longos da
      // Liturgia das Horas (mais rápida/barata, porém menos fiel em transcrição longa).
      // O "flash" normal é mais lento e consome mais cota gratuita, mas segue melhor a
      // regra 0c (proibido resumir) em textos extensos. Se algum dia a Google aposentar
      // este modelo, o sintoma é sempre o mesmo: erro 404 "model ... is no longer
      // available" em TODAS as chaves ao mesmo tempo (diferente de 429, que é só cota).
      model: "gemini-3.1-flash",
      contents,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        // CRÍTICO: sem um responseSchema explícito exigindo um ARRAY, o modo JSON
        // sozinho ("responseMimeType") não impede o Gemini de devolver um único
        // objeto solto (em vez de um array com 1 item) quando a página tem só uma
        // música — e, pior, de "colapsar" silenciosamente para o objeto da primeira
        // música quando a página tinha mais de uma. safeParseSongs() já sabia tratar
        // um objeto solto como "[objeto]", mas isso não ajuda se o array nunca
        // chegou a existir de fato na resposta do modelo. Forçar o schema como array
        // aqui é o único jeito de garantir, na saída do próprio modelo (não só no
        // parser depois), que todas as músicas da página apareçam.
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              artist: { type: "STRING" },
              category: { type: "STRING" },
              original_key: { type: "STRING" },
              content: { type: "STRING" },
              youtube_url: { type: "STRING" }
            },
            required: ["title", "content"]
          }
        },
        // Sem isso, um lote com várias músicas longas podia estourar o limite padrão
        // de tokens de saída do modelo e ser cortado no meio — o que ora quebrava o
        // JSON (caindo no rascunho bruto), ora silenciosamente resultava em só a
        // primeira música do lote sendo retornada, sem nenhum aviso de erro.
        maxOutputTokens: 32768
      }
    }),
    30000,
    "Gemini"
  );

  // Se a resposta foi cortada por atingir o limite de tokens, o JSON provavelmente
  // está incompleto e o resultado (mesmo que pareça válido) pode estar faltando
  // músicas do fim do lote. Melhor avisar já aqui do que devolver uma extração
  // parcial sem o usuário saber que faltou algo.
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new Error("Gemini: resposta cortada por limite de tokens (lote com músicas demais/muito longas)");
  }

  const text = response.text;
  if (!text) throw new Error("Gemini: resposta vazia");
  return safeParseSongs(text);
}

async function runGemini(env: any, images: string[], prompt: string): Promise<any[]> {
  const keys = getGeminiKeys(env);
  if (keys.length === 0) throw new Error("GEMINI_API_KEY não configurada");

  let lastErr: any = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      return await callGeminiWithKey(keys[i], images, prompt);
    } catch (err: any) {
      lastErr = err;
      const isQuota = /quota|429|resource_exhausted|rate.?limit/i.test(err?.message || "");
      // Só passa para a próxima chave se o motivo foi cota/limite de taxa —
      // se a chave for inválida ou outro erro qualquer, tentar as outras
      // chaves não vai resolver e só atrasa o retorno do erro real.
      if (isQuota && i < keys.length - 1) {
        console.error(`Gemini: chave #${i + 1} sem cota, tentando chave #${i + 2}...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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
    const result: any = await withTimeout(
      env.AI.run('@cf/moondream/moondream3.1-9B-A2B', {
        task: 'query',
        // O schema atual do Moondream 3.1 na Workers AI exige "image" como
        // string (URL pública ou data URI base64) — NÃO como array de bytes.
        // Enviar array de bytes (formato antigo/de outro modelo) causa o erro
        // "Type mismatch of '/image', 'string' not in 'array','binary'" e
        // derruba esse provedor sempre, mesmo com o binding 'AI' configurado
        // corretamente — era esse o motivo real da cascata nunca chegar até
        // aqui com sucesso.
        image: `data:image/jpeg;base64,${img}`,
        // O parâmetro correto para a pergunta da task "query" é "question",
        // não "prompt" — "prompt" não existe no schema deste modelo e era
        // silenciosamente ignorado, fazendo o Moondream sempre responder à
        // pergunta padrão ("What's in this image?") em vez de seguir as
        // regras de extração de cifras.
        question: prompt,
        reasoning: false,
        max_tokens: 4096
      }),
      8000,
      "Cloudflare Workers AI"
    );
    const raw = result?.answer ?? result?.result ?? result?.response ?? '';
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
    const { images, prompt, textBlocks } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "Images are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Blocos de texto pré-alinhados por coordenada (ver src/lib/chordproExtractor.ts
    // no cliente) — quando presentes, já trazem os acordes posicionados corretamente
    // para páginas com camada de texto real (cifra digital), calculados matematicamente
    // em vez de "adivinhados" visualmente pela IA. Concatenamos ao prompt para que todos
    // os provedores da cascata (que recebem só texto+imagens, não um campo separado)
    // vejam essa instrução junto com a regra 0 do prompt.
    const hasTextBlocks = Array.isArray(textBlocks) && textBlocks.length > 0;
    const fullPrompt = hasTextBlocks ? `${prompt}\n\n${textBlocks.join('\n\n')}` : prompt;

    const providers: { name: string; run: () => Promise<any[]> }[] = [
      { name: "Gemini", run: () => runGemini(env, images, fullPrompt) },
      { name: "Cloudflare Workers AI", run: () => runCloudflareWorkersAI(env, images, fullPrompt) },
      { name: "Groq", run: () => runGroq(env, images, fullPrompt) },
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
