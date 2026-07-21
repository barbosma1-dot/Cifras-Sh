// Endpoint de diagnóstico: NÃO faz nenhuma chamada de IA (não consome cota).
// Apenas informa quais dos 3 provedores da cascata de extração
// (functions/api/extract-pdf.ts) estão de fato configurados neste projeto
// Cloudflare Pages, para o admin conseguir descobrir rapidamente por que a
// extração caiu direto no erro de "limite de uso da IA atingido" — em vez de
// ter que adivinhar olhando os logs.
//
// Nunca devolve o valor das chaves, só se elas existem e (para o Gemini)
// se ainda estão com o valor de exemplo do .env.example.

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
