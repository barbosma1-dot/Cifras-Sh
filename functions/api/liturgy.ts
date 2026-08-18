import * as cheerio from "cheerio";

// Busca a página de Liturgia Diária do Católico Orante NO SERVIDOR (não no
// navegador da pessoa) e devolve só o texto da liturgia — sem anúncios, sem
// menu de navegação para outros dias, sem scripts.
//
// Por que isso existe: o app tentava salvar a página inteira (via iframe +
// cache do service worker) para uso offline, mas esse site injeta um anúncio
// de vídeo em tela cheia e parece tratar pedidos "programáticos" (fetch via
// JS) de forma diferente de uma navegação normal de navegador — o resultado
// era um cache "suspeito" (pequeno demais) que não representava a página
// real, e mesmo quando salvava algo, vinha junto com propaganda e links para
// outros dias. Buscar e limpar o HTML aqui no servidor evita os dois
// problemas: o texto salvo é sempre só a liturgia do dia, pequeno o
// suficiente para guardar em localStorage no aparelho da pessoa (sem
// depender do service worker/cache do navegador nem de a página permitir
// ser embutida em iframe), e sem anúncio nenhum.
export const onRequestGet = async (context: any) => {
  const { request } = context;
  const url = new URL(request.url);
  // No futuro, se quisermos alternar a fonte, basta aceitar ?source=paulus
  // etc. aqui. Por enquanto só temos o Católico Orante integrado.
  const sourceUrl = "https://www.catolicoorante.com.br/liturgia_diaria.php";

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': 'https://www.catolicoorante.com.br/'
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({
        error: `O site da liturgia respondeu com erro (${response.status}). Tente novamente em alguns minutos.`
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove tudo que não é o texto da liturgia em si: scripts, estilos,
    // anúncios (Google Ads costuma usar <ins class="adsbygoogle"> e iframes),
    // menus de navegação, cabeçalho/rodapé, botões de compartilhar, etc.
    $('script, style, noscript, iframe, ins, nav, header, footer, form').remove();
    $('[id*="ad" i], [class*="ad-" i], [class*="-ad" i], [class*="banner" i], [class*="cookie" i], [class*="menu" i], [class*="nav" i], [class*="social" i], [class*="share" i], [class*="comment" i], [class*="publicidade" i], [class*="anuncio" i]').remove();

    // O conteúdo principal costuma estar no corpo da página, dentro de algum
    // container central — tentamos alguns seletores comuns e, se nenhum
    // bater, caímos para o <body> inteiro já limpo dos itens acima.
    const candidateSelectors = ['main', '#content', '.content', '#liturgia', '.liturgia', 'article', '.container'];
    let container = null;
    for (const sel of candidateSelectors) {
      const el = $(sel);
      if (el.length > 0 && el.text().trim().length > 200) {
        container = el.first();
        break;
      }
    }
    const root = container || $('body');

    // Extrai o texto preservando quebras de parágrafo (cada bloco vira uma
    // linha), depois colapsa espaços/linhas em branco repetidas.
    const blocks: string[] = [];
    root.find('h1, h2, h3, h4, p, li, div').each((_, el) => {
      const txt = $(el).clone().children('h1,h2,h3,h4,p,li,div').remove().end().text().trim();
      if (txt) blocks.push(txt);
    });

    let text = blocks.join('\n\n');
    if (!text || text.length < 100) {
      // Fallback bruto: se os seletores acima não capturaram nada
      // significativo (site pode ter mudado de estrutura), usa o texto puro
      // do body limpo mesmo assim, melhor que devolver vazio.
      text = root.text();
    }
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '');

    // Remove linhas curtas repetidas de navegação/rodapé que sobreviveram
    // (ex.: "Voltar", "Próximo", "Compartilhar", nomes de redes sociais
    // soltos) sem arriscar apagar conteúdo real da liturgia.
    const junkLines = new Set(['voltar', 'próximo', 'proximo', 'compartilhar', 'whatsapp', 'facebook', 'twitter', 'telegram', 'copiar link']);
    text = text
      .split('\n')
      .filter(line => !junkLines.has(line.trim().toLowerCase()))
      .join('\n');

    const title = $('title').first().text().trim() || 'Liturgia Diária';

    if (!text || text.length < 80) {
      return new Response(JSON.stringify({
        error: 'Não foi possível extrair o texto da liturgia desta vez (o site pode ter mudado de estrutura). Tente novamente mais tarde ou use "Abrir no navegador".'
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      title,
      text,
      source: sourceUrl,
      fetchedAt: new Date().toISOString()
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error('Erro ao buscar liturgia:', err);
    return new Response(JSON.stringify({
      error: `Falha ao buscar a liturgia (${err?.message || 'erro desconhecido'}). Verifique sua conexão e tente novamente.`
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
