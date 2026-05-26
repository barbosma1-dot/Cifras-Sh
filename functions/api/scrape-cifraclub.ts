import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";

export const onRequestPost = async (context: any) => {
  const { request, env } = context;
  try {
    const body: any = await request.json();
    const { url } = body;

    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    let title = "";
    let artist = "";
    let key = "C";
    let content = "";

    console.log(`[Cloudflare Function] Fetching: ${url}`);
    
    // Cloudflare global fetch (compatible with Workers runtime)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.google.com/',
        'Sec-Ch-Ua': '"Google Chrome";v="118", "Chromium";v="118", "Not=A?Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"'
      }
    });

    const status = response.status;
    const html = await response.text();

    if (status === 200) {
      const $ = cheerio.load(html);

      // Try to get from Meta Tags
      const ogTitle = $('meta[property="og:title"]').attr('content') || 
                      $('meta[name="twitter:title"]').attr('content') ||
                      $('title').first().text();
                      
      if (ogTitle && ogTitle.includes('-')) {
        const parts = ogTitle.split('-').map(p => p.trim());
        const filtered = parts.filter(p => 
          !p.toLowerCase().includes('cifra club') && 
          !p.toLowerCase().includes('aprenda') && 
          !p.toLowerCase().includes('acordes')
        );
        if (filtered.length >= 2) {
          title = filtered[0];
          artist = filtered[1];
        } else if (filtered.length === 1) {
          title = filtered[0];
        }
      }

      // Title selectors fallback
      title = title || $(".t1").text().trim() || $("h1.t1").text().trim() || "Sem título";
      artist = artist || $(".t3").text().trim() || $("h2.t3").text().trim() || "Artista desconhecido";
      key = $("#cifra_tom").text().replace(/tom:/i, "").trim() || "C";
      if (key.includes('(')) key = key.split('(')[0].trim();
      
      // Content extraction
      const selectors = [".js-tab-content", "pre", "#cifra_cnt", ".cifra_cnt"];
      for (const selector of selectors) {
        const el = $(selector);
        if (el.length > 0) {
          if (el.length > 1) {
            let longest = "";
            el.each((_, item) => {
              const txt = $(item).text();
              if (txt.length > longest.length) longest = txt;
            });
            content = longest;
          } else {
            content = el.text();
          }
          if (content.length > 100) break;
        }
      }

      if (content) {
        const lines = content.split('\n');
        content = lines.filter(line => {
          const isTab = line.includes('|-') || line.includes('-|') || (line.match(/-/g) || []).length > 20;
          const isAd = line.toLowerCase().includes('cifra club pro') || line.toLowerCase().includes('baixar app');
          return !isTab && !isAd;
        }).join('\n').trim();
      }
    }

    // If scraping failed (blocked, empty, or error), fallback to Gemini with Search
    if (status !== 200 || !content || content.length < 100) {
      console.log(`[Cloudflare Function] Scraper fallback to Gemini Search for: ${url} (Status: ${status})`);
      
      const apiKey = env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const genAI = new GoogleGenAI({ 
            apiKey: apiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });
          
          const aiResponse = await genAI.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{ role: "user", parts: [{ text: `O link "${url}" está bloqueado por 403. 
            Sua tarefa é recuperar a cifra COMPLETA desta música do Cifra Club.
            Use a busca do Google para encontrar o conteúdo da página, snippets ou cache.
            Procure exatamente pela cifra como ela aparece no Cifra Club.
            
            Retorne APENAS um JSON: 
            { 
              "title": "Título Correto", 
              "artist": "Artista Correto", 
              "key": "Tom Original", 
              "content": "A cifra completa recuperada aqui" 
            }` }] }],
            config: {
              tools: [{ googleSearch: {} }],
              responseMimeType: "application/json"
            }
          });
          
          const aiData = JSON.parse(aiResponse.text || "{}");
          if (aiData.content && aiData.content.length > 50) {
            return new Response(JSON.stringify({
              title: aiData.title || title || "Sem título",
              artist: aiData.artist || artist || "Artista desconhecido",
              key: aiData.key || key || "C",
              content: aiData.content
            }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
        } catch (aiErr: any) {
          console.error("[Cloudflare Function] Gemini fallback failed:", aiErr.message);
          if (aiErr.message.includes("quota") || aiErr.message.includes("429") || aiErr.message.includes("RESOURCE_EXHAUSTED")) {
            return new Response(JSON.stringify({ 
              error: "Limite de uso da IA excedido.", 
              details: "Não foi possível recuperar a cifra via IA devido a limites de cota. Tente novamente mais tarde." 
            }), {
              status: 429,
              headers: { "Content-Type": "application/json" }
            });
          }
        }
      }

      // Final fallback: try to identify from slug if 403 and Gemini failed
      if (status === 403 && (!content || content.length < 50)) {
        const urlParts = url.split('/').filter(Boolean);
        if (urlParts.length >= 2) {
          const artistSlug = urlParts[urlParts.length - 2];
          const songSlug = urlParts[urlParts.length - 1];
          const formattedArtist = artistSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          const formattedTitle = songSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          
          return new Response(JSON.stringify({ 
            identified: true,
            title: formattedTitle,
            artist: formattedArtist,
            key: "C",
            content: "" 
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
    }

    return new Response(JSON.stringify({ 
      title: title.replace(/ cifra$/i, "").trim(), 
      artist, 
      content, 
      key: key
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Scraping error:", error.message);
    return new Response(JSON.stringify({ error: "Falha ao acessar o Cifra Club. Verifique se o link está correto." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
