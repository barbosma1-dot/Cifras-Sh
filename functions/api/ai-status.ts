// Endpoint de diagnóstico dos 3 provedores usados na cascata de extração
// (functions/api/extract-pdf.ts).
//
// GET  -> só verifica CONFIGURAÇÃO (chave/binding existe?). Não consome cota.
// POST -> faz um teste AO VIVO, com uma imagem 1x1 e um prompt mínimo, em
//         cada provedor. Isso é o único jeito confiável de saber se um
//         provedor "configurado" (GET) está de fato disponível AGORA —
//         porque "configurado" não quer dizer "com cota sobrando": o
//         Workers AI e o Groq também têm cota diária própria, só que maior
//         que a do Gemini, e podem estar esgotados mesmo com o binding/chave
//         presentes. O teste ao vivo gasta uma fração mínima de cota (uma
//         imagem 1x1, poucos tokens de saída) — bem menos que uma página real.
//
// Nunca devolve o valor das chaves, só se elas existem e (para o Gemini)
// se ainda estão com o valor de exemplo do .env.example.

// Imagem 1x1 px em base64 (JPEG), usada só para o teste ao vivo — não é uma
// página real, então o teste custa o mínimo possível de tokens/cota.
const TINY_TEST_IMAGE =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";
const TEST_PROMPT = 'Responda apenas com o JSON: [{"title":"teste","artist":"","category":"","original_key":"","content":"ok"}]';

async function testGeminiLive(env: any): Promise<{ ok: boolean; message: string }> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.includes("YOUR_API_KEY")) {
    return { ok: false, message: "Não configurado." };
  }
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [{ role: "user", parts: [{ text: TEST_PROMPT }, { inlineData: { mimeType: "image/jpeg", data: TINY_TEST_IMAGE } }] }],
      config: { temperature: 0.1, responseMimeType: "application/json", maxOutputTokens: 200 }
    });
    if (!response.text) return { ok: false, message: "Respondeu vazio (verificar chave/modelo)." };
    return { ok: true, message: "Respondendo normalmente agora." };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/quota|429|resource_exhausted|rate.?limit/i.test(msg)) {
      return { ok: false, message: "Cota esgotada agora (429/quota). Não é problema de configuração." };
    }
    return { ok: false, message: `Erro: ${msg}` };
  }
}

async function testWorkersAiLive(env: any): Promise<{ ok: boolean; message: string }> {
  if (!env.AI) return { ok: false, message: "Binding 'AI' ausente neste deploy." };
  try {
    const result: any = await env.AI.run("@cf/moondream/moondream3.1-9B-A2B", {
      task: "query",
      image: `data:image/jpeg;base64,${TINY_TEST_IMAGE}`,
      question: TEST_PROMPT,
      reasoning: false,
      max_tokens: 50
    });
    const raw = result?.answer ?? result?.result ?? result?.response ?? "";
    if (!raw) return { ok: false, message: "Respondeu vazio." };
    return { ok: true, message: "Respondendo normalmente agora." };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/quota|429|resource_exhausted|rate.?limit|capacity/i.test(msg)) {
      return { ok: false, message: "Cota/capacidade esgotada agora. Não é problema de configuração." };
    }
    return { ok: false, message: `Erro: ${msg}` };
  }
}

async function testGroqLive(env: any): Promise<{ ok: boolean; message: string }> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey || apiKey.length < 10) return { ok: false, message: "Não configurado." };
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "qwen/qwen3.6-27b",
        messages: [{ role: "user", content: [{ type: "text", text: TEST_PROMPT }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${TINY_TEST_IMAGE}` } }] }],
        temperature: 0.1,
        reasoning_effort: "none",
        max_tokens: 50
      })
    });
    if (res.ok) return { ok: true, message: "Respondendo normalmente agora." };
    const errText = await res.text().catch(() => "");
    if (res.status === 429 || /quota|rate.?limit/i.test(errText)) {
      return { ok: false, message: "Cota esgotada agora (429). Não é problema de configuração." };
    }
    return { ok: false, message: `Erro (${res.status}): ${errText.slice(0, 200)}` };
  } catch (err: any) {
    return { ok: false, message: `Erro: ${err?.message || err}` };
  }
}

export const onRequestPost = async (context: any) => {
  const { env } = context;
  const [gemini, workersAi, groq] = await Promise.all([
    testGeminiLive(env),
    testWorkersAiLive(env),
    testGroqLive(env)
  ]);
  const results = [
    { name: "Gemini", ...gemini },
    { name: "Cloudflare Workers AI", ...workersAi },
    { name: "Groq", ...groq }
  ];
  const anyOk = results.some(r => r.ok);
  return new Response(JSON.stringify({
    results,
    resumo: anyOk
      ? "Pelo menos um provedor está respondendo agora — a próxima extração deve funcionar."
      : "Nenhum dos 3 provedores respondeu com sucesso agora. Veja o motivo de cada um abaixo (configuração ausente x cota esgotada de verdade)."
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const onRequestGet = async (context: any) => {
  const { env } = context;

  const geminiKey = env.GEMINI_API_KEY as string | undefined;
  const groqKey = env.GROQ_API_KEY as string | undefined;

  const geminiConfigured = !!geminiKey && geminiKey !== "MY_GEMINI_API_KEY" && !geminiKey.includes("YOUR_API_KEY");
  const groqConfigured = !!groqKey && groqKey.length > 10;
  const workersAiConfigured = !!env.AI;

  const providers = [
    {
      name: "Gemini",
      configured: geminiConfigured,
      detail: geminiConfigured
        ? "Chave GEMINI_API_KEY presente."
        : "GEMINI_API_KEY ausente ou ainda com o valor de exemplo. Configure em Cloudflare Pages > Settings > Environment variables.",
      cota: "Tier gratuito: cota diária/por-minuto limitada. Costuma ser o primeiro a esgotar."
    },
    {
      name: "Cloudflare Workers AI",
      configured: workersAiConfigured,
      detail: workersAiConfigured
        ? "Binding 'AI' presente neste deploy."
        : "Binding 'AI' AUSENTE. Ative em Cloudflare Pages > Settings > Functions > Workers AI bindings (variável 'AI'). Depois de ativar, é preciso um novo deploy para valer.",
      cota: "Sem cota paga por chave própria (usa o tier gratuito de Workers AI da própria conta Cloudflare) — é a rede de segurança mais confiável para não travar a extração."
    },
    {
      name: "Groq",
      configured: groqConfigured,
      detail: groqConfigured
        ? "Chave GROQ_API_KEY presente."
        : "GROQ_API_KEY ausente. Configure em Cloudflare Pages > Settings > Environment variables (opcional, mas ajuda como 3º fallback).",
      cota: "Tier gratuito também tem limite diário próprio, independente do Gemini."
    }
  ];

  const configuredCount = providers.filter(p => p.configured).length;

  return new Response(JSON.stringify({
    providers,
    resumo: configuredCount === 0
      ? "NENHUM provedor de IA está configurado. A extração de PDF vai falhar sempre."
      : configuredCount === 1
      ? "Apenas 1 provedor configurado — sem rede de segurança. Se ele bater a cota, a extração para até o limite resetar."
      : `${configuredCount} de 3 provedores configurados.`,
    recomendacao: !workersAiConfigured
      ? "Recomendado: ative o binding 'AI' (Workers AI) no Cloudflare Pages. É o único provedor da lista sem cota por chave própria, então ele evita a maioria das paradas por 'limite de uso da IA atingido'."
      : "Workers AI está ativo como rede de segurança — bom sinal."
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};
