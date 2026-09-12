import { supabase } from './supabase';

/**
 * Extrai bucket e path de uma URL pública do Supabase Storage.
 * Formato esperado: https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path...>
 * Retorna null se a URL não tiver esse formato (ex.: link externo do YouTube,
 * ou string vazia) — nesses casos não há nada pra apagar no Storage.
 */
export function parseStoragePublicUrl(url: string): { bucket: string; path: string } | null {
  if (!url) return null;
  const marker = '/storage/v1/object/public/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;

  const rest = url.slice(idx + marker.length);
  const [bucket, ...pathParts] = rest.split('/');
  if (!bucket || pathParts.length === 0) return null;

  try {
    return { bucket, path: decodeURIComponent(pathParts.join('/')) };
  } catch {
    return { bucket, path: pathParts.join('/') };
  }
}

/**
 * Extrai o "path" (ex.: "audio/123-abc.mp3") de uma URL de áudio servida
 * pelo jsDelivr a partir do repositório GitHub de áudio (ver
 * functions/api/upload-audio.ts). Formato esperado:
 * https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path...>
 * Retorna null se a URL não for desse formato.
 */
export function parseGithubAudioUrl(url: string): { path: string } | null {
  if (!url) return null;
  const marker = 'cdn.jsdelivr.net/gh/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;

  const rest = url.slice(idx + marker.length); // "<owner>/<repo>@<branch>/<path...>"
  const slashIdx = rest.indexOf('/', rest.indexOf('@'));
  if (slashIdx === -1) return null;

  const path = rest.slice(slashIdx + 1);
  return path ? { path } : null;
}

/**
 * Apaga do Storage os arquivos correspondentes às URLs informadas, agrupando
 * por bucket (a API do Supabase só apaga vários arquivos de um bucket por vez).
 * URLs de áudio hospedadas no GitHub (jsDelivr) são apagadas separadamente,
 * chamando o endpoint /api/upload-audio (DELETE).
 *
 * É "melhor esforço" de propósito: os erros são logados mas nunca lançados.
 * Quem chama essa função já fez a mudança que importa no banco (excluir a
 * cifra, ou salvar a nova lista de anexos) — se a limpeza do Storage falhar
 * (rede, permissão, etc.), o pior cenário é um arquivo órfão que pode ser
 * limpo depois, e não vale a pena reverter ou travar a ação principal por isso.
 */
export async function removeStorageFilesByUrl(urls: string[]): Promise<void> {
  const porBucket = new Map<string, string[]>();
  const githubAudioPaths: string[] = [];

  for (const url of urls) {
    const githubAudio = parseGithubAudioUrl(url);
    if (githubAudio) {
      githubAudioPaths.push(githubAudio.path);
      continue;
    }
    const parsed = parseStoragePublicUrl(url);
    if (!parsed) continue;
    const lista = porBucket.get(parsed.bucket) || [];
    lista.push(parsed.path);
    porBucket.set(parsed.bucket, lista);
  }

  for (const [bucket, paths] of porBucket.entries()) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      console.error(`Falha ao apagar ${paths.length} arquivo(s) do bucket "${bucket}":`, error);
    }
  }

  for (const path of githubAudioPaths) {
    try {
      const res = await fetch(`/api/upload-audio?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`Falha ao apagar áudio "${path}" do GitHub:`, errText);
      }
    } catch (err) {
      console.error(`Falha de rede ao apagar áudio "${path}" do GitHub:`, err);
    }
  }
}
