import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ limit: "100mb", extended: true }));

  const checkApiKey = (apiKey: string | undefined) => {
    if (!apiKey) return { valid: false, message: "GEMINI_API_KEY não configurada no servidor." };
    if (apiKey === "MY_GEMINI_API_KEY" || apiKey.includes("YOUR_API_KEY")) {
      return { valid: false, message: "GEMINI_API_KEY ainda está com o valor padrão do exemplo (.env.example). Por favor, configure sua chave real no painel de Segredos (Secrets) do AI Studio ou no ambiente do servidor." };
    }
    return { valid: true };
  };

  // API Route for AI Proxy
  app.post("/api/ai-proxy", async (req, res) => {
    const { prompt, model, systemInstruction, responseMimeType } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    const keyCheck = checkApiKey(apiKey);
    if (!keyCheck.valid) {
      console.error("[AI Proxy]", keyCheck.message);
      return res.status(500).json({ error: keyCheck.message });
    }

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ 
        apiKey: apiKey!,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const result = await ai.models.generateContent({
        model: model || "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.1,
          responseMimeType: responseMimeType || "text/plain",
          systemInstruction: systemInstruction
        },
      });

      const text = result.text;
      res.json({ text });
    } catch (error: any) {
      console.error("AI Proxy error:", error.message);
      let details = error.message;
      if (details.includes("API key not valid")) {
        details = "A chave de API do Gemini (GEMINI_API_KEY) foi rejeitada pelo servidor do Google. Verifique se a chave está correta no painel de Segredos.";
      } else if (details.includes("quota") || details.includes("429") || details.includes("RESOURCE_EXHAUSTED")) {
        details = "Limite de uso gratuito da IA excedido (Quota Exceeded). Aguarde alguns minutos e tente novamente. Se o problema persistir, reduza a quantidade de texto enviada.";
      }
      res.status(500).json({ error: "Erro no processamento da IA", details });
    }
  });

  // API Route for PDF Music Extraction
  app.post("/api/extract-pdf", async (req, res) => {
    const { images, prompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    const keyCheck = checkApiKey(apiKey);
    if (!keyCheck.valid) {
      console.error("[PDF Extract]", keyCheck.message);
      return res.status(500).json({ error: keyCheck.message });
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "Nenhuma imagem foi enviada para extração." });
    }

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ 
        apiKey: apiKey!,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const contents = [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...images.map((img: string) => ({
              inlineData: {
                mimeType: "image/jpeg",
                data: img
              }
            }))
          ]
        }
      ];

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
        config: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      });

      const text = result.text || "";
      // Basic cleaning in case of markdown blocks
      const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
      res.json(JSON.parse(cleanJson));
    } catch (error: any) {
      console.error("PDF Extraction error:", error.message);
      let details = error.message;
      if (details.includes("API key not valid")) {
        details = "Chave de API inválida. Por favor, verifique a GEMINI_API_KEY nas configurações de Segredos.";
      } else if (details.includes("quota") || details.includes("429") || details.includes("RESOURCE_EXHAUSTED")) {
        details = "Limite de uso gratuito da IA para extração de PDFs excedido. Aguarde cerca de 1 minuto ou tente extrair menos páginas de cada vez.";
      }
      res.status(500).json({ error: "Falha na extração por IA", details });
    }
  });

  // API Route for Cifra Club Scraper
  app.post("/api/scrape-cifraclub", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    let title = "";
    let artist = "";
    let key = "C";
    let content = "";

    try {
      console.log(`[Scraper] Fetching: ${url}`);
      const { data: html, status } = await axios.get(url, {
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
        },
        timeout: 15000,
        validateStatus: (s) => true // Capture errors manually
      });

      if (status === 200) {
        const $ = cheerio.load(html);

        // 1. Try to get from Meta Tags
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
            const trimmed = line.trim();
            if (!trimmed) return true;
            const isTab = line.includes('|-') || line.includes('-|') || (line.match(/-/g) || []).length > 20;
            const isAd = line.toLowerCase().includes('cifra club pro') || line.toLowerCase().includes('baixar app');
            return !isTab && !isAd;
          }).join('\n').trim();
        }
      }

      // If scraping failed (blocked, error, or empty content), use Gemini Search
      if (status !== 200 || !content || content.length < 100) {
        console.log(`[Scraper] Using Gemini fallback for: ${url} (Status: ${status})`);
        
        const apiKey = process.env.GEMINI_API_KEY;
        const keyCheck = checkApiKey(apiKey);
        
        if (keyCheck.valid) {
          try {
            const { GoogleGenAI, Type } = await import("@google/genai");
            const aiDataClient = new GoogleGenAI({ 
              apiKey: apiKey!,
              httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
            });
            
            const response = await aiDataClient.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: [{ role: "user", parts: [{ text: `O link "${url}" está bloqueado por 403. 
              Sua tarefa é recuperar a cifra COMPLETA desta música do Cifra Club.
              Use a busca do Google para encontrar o conteúdo da página, snippets ou cache.
              Procure exatamente pela cifra como ela aparece no Cifra Club (com acordes sobre a letra ou em ChordPro).
              
              Retorne APENAS um JSON: 
              { 
                "title": "Título Correto", 
                "artist": "Artista Correto", 
                "key": "Tom Original", 
                "content": "A cifra completa recuperada aqui" 
              }` }] }],
              config: {
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    artist: { type: Type.STRING },
                    key: { type: Type.STRING },
                    content: { type: Type.STRING }
                  },
                  required: ["title", "artist", "content"]
                }
              }
            });
            
            const aiData = JSON.parse(response.text || "{}");
            if (aiData.content && aiData.content.length > 50) {
              return res.json({
                title: aiData.title || title || "Sem título",
                artist: aiData.artist || artist || "Artista desconhecido",
                key: aiData.key || key || "C",
                content: aiData.content
              });
            }
          } catch (aiErr: any) {
            console.error("[Scraper] Gemini fallback failed:", aiErr.message);
          }
        }

        // Final identifier fallback if Gemini also failed or no API key
        if (status === 403 && (!content || content.length < 50)) {
           const urlParts = url.split('/').filter(Boolean);
           if (urlParts.length >= 2) {
              const artistSlug = urlParts[urlParts.length - 2];
              const songSlug = urlParts[urlParts.length - 1];
              const formattedArtist = artistSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              const formattedTitle = songSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              
              return res.status(200).json({ 
                identified: true,
                title: formattedTitle,
                artist: formattedArtist,
                key: "C",
                content: "" 
              });
           }
        }
      }

      res.json({ 
        title: title.replace(/ cifra$/i, "").trim() || "Sem título", 
        artist: artist || "Artista desconhecido", 
        content: content || "", 
        key: key || "C"
      });
    } catch (error: any) {
      console.error("Scraping error:", error.message);
      res.status(500).json({ error: "Falha ao acessar o Cifra Club. Verifique se o link está correto." });
    }
  });

  // API Route for YouTube Search
  app.get("/api/youtube-search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Query is required" });

    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q as string)}`;
      const { data: html } = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      // Simple regex to find the first video ID
      const match = html.match(/"videoId":"([^"]+)"/);
      const videoId = match ? match[1] : null;
      
      if (videoId) {
        res.json({ videoUrl: `https://www.youtube.com/watch?v=${videoId}` });
      } else {
        res.json({ videoUrl: null });
      }
    } catch (error: any) {
      console.error("YouTube search error:", error.message);
      res.status(500).json({ error: "Failed to search YouTube" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  return app;
}

export const appPromise = startServer();
