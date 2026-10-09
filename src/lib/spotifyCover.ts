/**
 * Capa (imagem) e título de um link do Spotify, via oEmbed público
 * (https://open.spotify.com/oembed) — não precisa de chave de API.
 *
 * Fluxo:
 *  1. Cache em localStorage (a capa de uma faixa não muda) — também serve
 *     de fallback quando o app está offline.
 *  2. Busca direta no navegador.
 *  3. Se a busca direta falhar (ex.: bloqueio de CORS), tenta pela função
 *     do servidor `/api/spotify-oembed` (functions/api/spotify-oembed.ts).
 *  4. Se tudo falhar, devolve null e a tela segue sem capa (nunca quebra).
 */

export interface SpotifyCover {
  thumbnailUrl: string;
  title: string;
}

const CACHE_PREFIX = 'spotify_cover_v1:';
const SPOTIFY_URL_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/[a-zA-Z0-9]+/i;

// Pedidos em andamento, para não buscar duas vezes a mesma URL ao mesmo tempo
// (ex.: o painel e o editor pedindo juntos).
const inflight = new Map<string, Promise<SpotifyCover | null>>();

/** Normaliza o link (remove parâmetros de rastreio como ?si=...). */
export function normalizeSpotifyUrl(url: string): string | null {
  const m = (url || '').trim().match(SPOTIFY_URL_RE);
  return m ? m[0] : null;
}

function readCache(key: string): SpotifyCover | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.thumbnailUrl === 'string') return parsed as SpotifyCover;
  } catch {
    /* localStorage indisponível ou JSON inválido: ignora */
  }
  return null;
}

function writeCache(key: string, value: SpotifyCover) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* cheio ou bloqueado: ignora */
  }
}

function toCover(data: any): SpotifyCover | null {
  if (!data || typeof data.thumbnail_url !== 'string' || !data.thumbnail_url) return null;
  return {
    thumbnailUrl: data.thumbnail_url,
    title: typeof data.title === 'string' ? data.title : ''
  };
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function getCachedSpotifyCover(spotifyUrl: string): SpotifyCover | null {
  const key = normalizeSpotifyUrl(spotifyUrl);
  return key ? readCache(key) : null;
}

export function fetchSpotifyCover(spotifyUrl: string): Promise<SpotifyCover | null> {
  const key = normalizeSpotifyUrl(spotifyUrl);
  if (!key) return Promise.resolve(null);

  const cached = readCache(key);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(key);
  if (existing) return existing;

  const job = (async (): Promise<SpotifyCover | null> => {
    const enc = encodeURIComponent(key);
    // 1) direto
    try {
      const cover = toCover(await fetchJson(`https://open.spotify.com/oembed?url=${enc}`, 8000));
      if (cover) {
        writeCache(key, cover);
        return cover;
      }
    } catch {
      /* cai para a função do servidor */
    }
    // 2) pela função do servidor
    try {
      const cover = toCover(await fetchJson(`/api/spotify-oembed?url=${enc}`, 10000));
      if (cover) {
        writeCache(key, cover);
        return cover;
      }
    } catch {
      /* sem capa */
    }
    return null;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, job);
  return job;
}
