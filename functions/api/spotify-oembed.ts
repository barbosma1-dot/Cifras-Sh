// Proxy do oEmbed público do Spotify (sem chave de API). Usado por
// src/lib/spotifyCover.ts quando a busca direta do navegador falha (CORS).
// Só aceita links open.spotify.com para não virar um proxy aberto.
const SPOTIFY_URL_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/[a-zA-Z0-9]+/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": status === 200 ? "public, max-age=86400" : "no-store"
    }
  });

export const onRequestGet = async (context: any) => {
  const { request } = context;
  const target = new URL(request.url).searchParams.get("url") || "";
  const match = target.match(SPOTIFY_URL_RE);

  if (!match) {
    return json({ error: "Invalid Spotify URL" }, 400);
  }

  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(match[0])}`
    );
    if (!res.ok) return json({ error: "Spotify oEmbed failed" }, 502);
    const data: any = await res.json();
    return json({ thumbnail_url: data.thumbnail_url, title: data.title });
  } catch (error: any) {
    console.error("Spotify oEmbed error:", error?.message);
    return json({ error: "Failed to fetch Spotify cover" }, 500);
  }
};
