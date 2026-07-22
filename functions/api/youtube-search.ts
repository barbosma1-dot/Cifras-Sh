export const onRequestGet = async (context: any) => {
  const { request } = context;
  const url = new URL(request.url);
  const q = url.searchParams.get("q");

  if (!q) {
    return new Response(JSON.stringify({ error: "Query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const videoUrl = await findBestYoutubeMatch(q);
    return new Response(JSON.stringify({ videoUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    console.error("YouTube search error:", error.message);
    return new Response(JSON.stringify({ error: "Failed to search YouTube" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

// Extração robusta do primeiro resultado de vídeo real da página de busca do
// YouTube.
//
// A versão anterior fazia `html.match(/"videoId":"([^"]+)"/)` pegando a
// PRIMEIRA ocorrência de "videoId" no HTML bruto — mas a página de resultados
// do YouTube contém dezenas de "videoId" fora da lista de resultados (chips
// de filtro, "vídeos relacionados" embutidos no rodapé, anúncios, dados de
// telemetria/analytics), então o primeiro match quase nunca era o primeiro
// resultado de busca de fato, e muitas vezes caía num vídeo sem relação
// nenhuma com a música pesquisada.
//
// Esta versão localiza o bloco `ytInitialData` (o JSON que o próprio YouTube
// usa para renderizar a página) e extrai especificamente objetos
// `videoRenderer` — que são exclusivamente resultados de vídeo na lista de
// busca, nunca anúncio/telemetria/chip de filtro — mantendo a ordem em que
// aparecem (ou seja, o primeiro é o resultado mais relevante segundo o
// próprio YouTube). Também filtra Shorts, que raramente são o vídeo
// "oficial" da música que o usuário está catalogando.
async function findBestYoutubeMatch(query: string): Promise<string | null> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9'
    }
  });
  const html = await response.text();

  const dataMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});/s)
    || html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s);

  const candidates: { videoId: string; title: string; isShort: boolean }[] = [];

  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      collectVideoRenderers(data, candidates);
    } catch {
      // JSON malformado/truncado — cai no fallback por regex abaixo.
    }
  }

  if (candidates.length === 0) {
    // Fallback: procura os primeiros pares "videoRenderer":{"videoId":"...
    // diretamente por regex, caso o parse do JSON completo falhe (o HTML do
    // YouTube às vezes vem minificado de um jeito que quebra JSON.parse).
    const re = /"videoRenderer":\{"videoId":"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      candidates.push({ videoId: m[1], title: '', isShort: false });
    }
  }

  const best = candidates.find(c => !c.isShort) || candidates[0];
  return best ? `https://www.youtube.com/watch?v=${best.videoId}` : null;
}

// Percorre recursivamente o JSON de `ytInitialData` procurando nós
// `videoRenderer` (resultados de vídeo) em qualquer profundidade — a
// estrutura exata varia entre "layout A/B" do YouTube, então navegar por
// caminho fixo (ex.: `contents.twoColumn...`) quebra com frequência; a busca
// recursiva por chave é resiliente a isso.
function collectVideoRenderers(
  node: any,
  out: { videoId: string; title: string; isShort: boolean }[],
  depth = 0
): void {
  if (!node || typeof node !== 'object' || depth > 40) return;

  if (node.videoRenderer && typeof node.videoRenderer.videoId === 'string') {
    const vr = node.videoRenderer;
    const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
    const isShort = Array.isArray(vr.thumbnailOverlays)
      ? vr.thumbnailOverlays.some((o: any) => !!o.reelWatchEndpointOverlay)
      : false;
    out.push({ videoId: vr.videoId, title, isShort });
    return; // não precisa descer mais dentro de um videoRenderer já capturado
  }

  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) collectVideoRenderers(item, out, depth + 1);
    } else if (child && typeof child === 'object') {
      collectVideoRenderers(child, out, depth + 1);
    }
  }
}
