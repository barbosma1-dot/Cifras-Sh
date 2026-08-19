import * as cheerio from "cheerio";

// Busca a Liturgia Diária NO SERVIDOR (não no navegador da pessoa) e devolve
// só o texto — sem anúncios, sem menu de navegação para outros dias, sem
// scripts — pronto pra guardar em localStorage e usar offline.
//
// Fonte: sagradaliturgia.com.br, que — diferente do Católico Orante usado
// antes — tem suporte NATIVO a escolher a data via `?date=AAAA-MM-DD` na URL,
// o que permite buscar a liturgia de um dia específico (ex.: o dia de um
// repertório futuro), não só "hoje".
//
// Detalhe importante descoberto na prática: às vezes esse site "escorrega"
// silenciosamente para uma data diferente da pedida (sem erro HTTP, só
// devolve o conteúdo de outro dia) — provavelmente cache/CDN na frente dele.
// Por isso, depois de extrair o texto, conferimos se a data que aparece no
// próprio texto bate com a data pedida antes de considerar sucesso; se não
// bater, avisamos o app em vez de silenciosamente salvar o dia errado.
export const onRequestGet = async (context: any) => {
  const { request } = context;
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get('date'); // formato AAAA-MM-DD, opcional (vazio = hoje)

  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return new Response(JSON.stringify({ error: 'Data inválida. Use o formato AAAA-MM-DD.' }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const sourceUrl = `https://sagradaliturgia.com.br/liturgia_diaria.php${requestedDate ? `?date=${requestedDate}` : ''}`;

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': 'https://sagradaliturgia.com.br/'
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
    // anúncios, menus, cabeçalho/rodapé, e especificamente o painel de
    // "Escolher outra data" (calendário/formulário — id "leftpanel1", âncora
    // usada pelo próprio link "Escolher outra data" na página).
    $('script, style, noscript, iframe, ins, nav, header, footer, form').remove();
    $('#leftpanel1, .leftpanel, .calendar, .datepicker').remove();
    $('[id*="ad" i], [class*="ad-" i], [class*="-ad" i], [class*="banner" i], [class*="cookie" i], [class*="menu" i], [class*="nav" i], [class*="social" i], [class*="share" i], [class*="comment" i], [class*="publicidade" i], [class*="anuncio" i]').remove();
    // Links de navegação entre dias ("Voltar"/"Próximo") não são conteúdo da
    // liturgia — removidos pelo texto do link, não só por classe/id, porque
    // esse site parece não usar classes previsíveis para eles.
    $('a').each((_, el) => {
      const t = $(el).text().trim().toLowerCase();
      if (['voltar', 'próximo', 'proximo', 'escolher outra data', 'escolher data'].includes(t)) {
        $(el).remove();
      }
    });

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

    const blocks: string[] = [];
    root.find('h1, h2, h3, h4, p, li, div').each((_, el) => {
      const txt = $(el).clone().children('h1,h2,h3,h4,p,li,div').remove().end().text().trim();
      if (txt) blocks.push(txt);
    });

    let text = blocks.join('\n\n');
    if (!text || text.length < 100) {
      text = root.text();
    }
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '');

    const junkLines = new Set(['voltar', 'próximo', 'proximo', 'compartilhar', 'whatsapp', 'facebook', 'twitter', 'telegram', 'copiar link', 'escolher outra data', 'escolher data:', 'escolher data']);
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

    // Confere se a data que veio no texto bate com a data pedida — ver
    // explicação no topo do arquivo sobre o site às vezes devolver outro dia
    // silenciosamente.
    const resolvedDate = extractDateFromText(text);
    const dateMismatch = !!(requestedDate && resolvedDate && resolvedDate !== requestedDate);

    return new Response(JSON.stringify({
      title,
      text,
      source: sourceUrl,
      fetchedAt: new Date().toISOString(),
      requestedDate: requestedDate || null,
      resolvedDate,
      dateMismatch
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error('Erro ao buscar liturgia:', err);
    return new Response(JSON.stringify({
      error: `Falha ao buscar a liturgia (${err?.message || 'erro desconhecido'}). Verifique sua conexão e tente novamente.`
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

// Procura no texto extraído um cabeçalho de data no formato do site
// ("Terça-feira, 18 de Agosto de 2026") e devolve em AAAA-MM-DD, ou null se
// não encontrar nada reconhecível (não bloqueia o resto do fluxo por isso).
const MONTHS_PT: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
};

function extractDateFromText(text: string): string | null {
  const match = text.match(/(\d{1,2})\s+de\s+([a-zA-Zçãéê]+)\s+de\s+(\d{4})/i);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = MONTHS_PT[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}
