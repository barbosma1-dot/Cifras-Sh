// functions/api/upload-audio.ts
//
// Recebe o áudio já comprimido no navegador (ver src/lib/audioCompress.ts) e
// commita no repositório público GitHub "Cifras-Sh-audio", servindo depois
// pela CDN gratuita do jsDelivr — substitui o upload direto pro Supabase
// Storage, que estava batendo no limite de espaço/banda do plano free.
//
// Variáveis de ambiente necessárias (configurar em Cloudflare Pages >
// Settings > Environment variables, como "Secret" para o token):
//   GITHUB_AUDIO_TOKEN  -> Personal Access Token com permissão de escrita
//                          SÓ no repositório de áudio (fine-grained token,
//                          repositório: Cifras-Sh-audio, permissão:
//                          Contents: Read and write)
//   GITHUB_AUDIO_OWNER  -> "barbosma1-dot"
//   GITHUB_AUDIO_REPO   -> "Cifras-Sh-audio"
//   GITHUB_AUDIO_BRANCH -> opcional, default "main"

interface UploadBody {
  filename: string;       // nome original do arquivo (só usado pra pegar a extensão)
  contentBase64: string;  // conteúdo do arquivo já em base64 (sem o prefixo "data:...;base64,")
  songId?: string;        // id da música no Supabase, se houver — ajuda a organizar/depurar
}

const MAX_BASE64_LENGTH = 60 * 1024 * 1024; // ~45MB de arquivo original vira ~60MB em base64

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// Gera um nome de arquivo único e "seguro" (sem espaços/acentos) pra evitar
// colisão entre músicas diferentes e problemas de encoding na URL do jsDelivr.
function buildAudioPath(filename: string, songId?: string): string {
  const extMatch = filename.match(/\.[^.]+$/);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".mp3";
  const uniqueId = songId
    ? `${songId}-${Date.now()}`
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `audio/${uniqueId}${ext}`;
}

function getConfig(env: any): { token: string; owner: string; repo: string; branch: string } | null {
  const token = env.GITHUB_AUDIO_TOKEN;
  const owner = env.GITHUB_AUDIO_OWNER;
  const repo = env.GITHUB_AUDIO_REPO;
  if (!token || !owner || !repo) return null;
  return { token, owner, repo, branch: env.GITHUB_AUDIO_BRANCH || "main" };
}

function jsDelivrUrl(owner: string, repo: string, branch: string, path: string): string {
  // @<branch> em vez de @<sha> pra sempre servir a versão mais recente daquele
  // caminho. O jsDelivr cacheia agressivamente por path, mas como cada upload
  // gera um path novo (timestamp no nome), isso nunca é um problema de cache
  // servindo conteúdo velho.
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
}

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: corsHeaders() });
};

export const onRequestPost = async (context: any) => {
  const { request, env } = context;

  const config = getConfig(env);
  if (!config) {
    return jsonResponse(
      {
        error:
          "Upload de áudio via GitHub não configurado no servidor. Configure GITHUB_AUDIO_TOKEN, GITHUB_AUDIO_OWNER e GITHUB_AUDIO_REPO em Cloudflare Pages > Settings > Environment variables.",
      },
      500
    );
  }

  let body: UploadBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido (esperado JSON)." }, 400);
  }

  const { filename, contentBase64, songId } = body;

  if (!filename || !contentBase64) {
    return jsonResponse({ error: "Campos obrigatórios ausentes: filename, contentBase64." }, 400);
  }

  if (contentBase64.length > MAX_BASE64_LENGTH) {
    return jsonResponse(
      { error: `Arquivo grande demais (limite de ~45MB após compressão).` },
      413
    );
  }

  const path = buildAudioPath(filename, songId);
  const apiUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;

  try {
    const githubResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cifras-sh-audio-uploader",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Upload de áudio: ${path}`,
        content: contentBase64,
        branch: config.branch,
      }),
    });

    if (!githubResponse.ok) {
      const errText = await githubResponse.text().catch(() => "");
      console.error(`GitHub API respondeu ${githubResponse.status}: ${errText}`);
      return jsonResponse(
        {
          error: `Falha ao enviar pro GitHub (${githubResponse.status}). Verifique se o token ainda é válido e tem permissão de escrita no repositório.`,
          details: errText.slice(0, 300),
        },
        502
      );
    }

    const githubData: any = await githubResponse.json();
    const sha = githubData?.content?.sha;

    return jsonResponse(
      {
        url: jsDelivrUrl(config.owner, config.repo, config.branch, path),
        path,
        sha,
      },
      200
    );
  } catch (err: any) {
    console.error("Erro ao fazer upload de áudio pro GitHub:", err);
    return jsonResponse({ error: `Erro de rede ao contatar o GitHub: ${err?.message || err}` }, 500);
  }
};

// Apaga um áudio do repositório — espelha a lógica "melhor esforço" de
// src/lib/storageCleanup.ts (erros são logados, mas não bloqueiam a ação
// principal de quem chamou). Recebe o "path" (ex.: "audio/123-abc.mp3") via
// query string: DELETE /api/upload-audio?path=audio/123-abc.mp3
export const onRequestDelete = async (context: any) => {
  const { request, env } = context;

  const config = getConfig(env);
  if (!config) {
    return jsonResponse({ error: "Upload de áudio via GitHub não configurado no servidor." }, 500);
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return jsonResponse({ error: "Parâmetro 'path' é obrigatório." }, 400);
  }

  const apiUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;

  try {
    // A API de exclusão do GitHub exige o "sha" atual do arquivo — buscamos
    // primeiro em vez de exigir que o cliente guarde/envie isso.
    const getResponse = await fetch(`${apiUrl}?ref=${config.branch}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cifras-sh-audio-uploader",
      },
    });

    if (!getResponse.ok) {
      // Arquivo já não existe (ou nunca existiu) — não é um erro fatal pra
      // quem chamou, o resultado desejado (arquivo fora do repo) já é real.
      if (getResponse.status === 404) return jsonResponse({ deleted: false, alreadyGone: true }, 200);
      const errText = await getResponse.text().catch(() => "");
      return jsonResponse({ error: `Falha ao localizar arquivo no GitHub: ${errText.slice(0, 300)}` }, 502);
    }

    const fileData: any = await getResponse.json();
    const sha = fileData?.sha;

    const deleteResponse = await fetch(apiUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cifras-sh-audio-uploader",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Remover áudio: ${path}`,
        sha,
        branch: config.branch,
      }),
    });

    if (!deleteResponse.ok) {
      const errText = await deleteResponse.text().catch(() => "");
      console.error(`Falha ao apagar "${path}" do GitHub:`, errText);
      return jsonResponse({ error: `Falha ao apagar do GitHub: ${errText.slice(0, 300)}` }, 502);
    }

    return jsonResponse({ deleted: true }, 200);
  } catch (err: any) {
    console.error(`Erro ao apagar "${path}" do GitHub:`, err);
    return jsonResponse({ error: `Erro de rede ao contatar o GitHub: ${err?.message || err}` }, 500);
  }
};
