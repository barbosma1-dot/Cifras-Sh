/**
 * Busca de vídeo do YouTube por música — lógica única, compartilhada entre:
 *  - src/components/PDFImporter.tsx (preenchimento automático durante a importação de PDF)
 *  - src/components/ChordEditor.tsx (botão de busca manual na edição de uma cifra)
 *  - src/components/ChordsList.tsx (botão "Preencher YouTube faltantes" em lote, tela de listagem)
 *
 * Extraído para cá para não ter três cópias do mesmo critério de busca
 * divergindo com o tempo — qualquer ajuste na query (ex.: novo termo, nova
 * regra de limpeza de título) só precisa ser feito uma vez, aqui.
 */

// Categorias litúrgicas "genéricas" que NÃO ajudam a identificar a música
// (toda cifra tem uma dessas) — o que sobra depois de tirá-las da lista de
// categorias normalmente é o nome do álbum/coletânea/ministério, um critério
// de busca bem mais preciso que "artista: Desconhecido".
export const GENERIC_YOUTUBE_CATEGORIES = new Set([
  'missa', 'louvor', 'adoração', 'oração', 'ação de graças', 'outros'
]);

/**
 * Monta a query de busca: título + artista (quando conhecido) + nome do
 * álbum (categoria não-genérica) + nome do PDF de origem + "letra e cifra".
 * O nome do PDF é o critério mais preciso disponível: costuma trazer o nome
 * do hinário/coletânea/ministério impresso no arquivo, o que desempata entre
 * várias versões da mesma música por artistas diferentes (ex.: "Santo dos
 * Santos" tem versões de vários ministérios; sem esse contexto a busca cai
 * facilmente na versão mais popular, não na do PDF/caderno de origem).
 */
export function buildYoutubeQuery(
  title: string,
  artist?: string,
  category?: string,
  pdfFileName?: string
): string {
  // Corta qualquer trecho de letra/observação colado no título entre
  // parênteses/traço antes de usar como termo de busca — evita que um título
  // "sujo" prejudique a precisão.
  const cleanTitle = (title || '').split(/[(\-–—]/)[0].trim() || (title || '').trim();
  if (!cleanTitle) return '';

  const parts = [cleanTitle];

  const cleanArtist = artist && artist.trim() && artist.trim().toLowerCase() !== 'desconhecido'
    ? artist.trim()
    : '';
  if (cleanArtist) parts.push(cleanArtist);

  if (category) {
    const albumCategories = category
      .split(',')
      .map(c => c.trim())
      .filter(c => c && !GENERIC_YOUTUBE_CATEGORIES.has(c.toLowerCase()));
    parts.push(...albumCategories);
  }

  if (pdfFileName) {
    const cleanName = pdfFileName.replace(/\.pdf$/i, '').replace(/[_\-.]+/g, ' ').trim();
    if (cleanName) parts.push(cleanName);
  }

  parts.push('letra e cifra');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Busca no YouTube pelo nome da música + artista/álbum/PDF de origem e devolve a URL do primeiro resultado (ou null). */
export async function searchYoutubeForSong(
  title: string,
  artist?: string,
  category?: string,
  pdfFileName?: string
): Promise<string | null> {
  const query = buildYoutubeQuery(title, artist, category, pdfFileName);
  if (!query) return null;
  try {
    const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.videoUrl || null;
  } catch (err) {
    console.error('Erro ao buscar vídeo no YouTube:', err);
    return null;
  }
}
