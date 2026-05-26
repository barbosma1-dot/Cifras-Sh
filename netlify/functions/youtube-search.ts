import { Config, Context } from "@netlify/functions";
import axios from "axios";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");

  if (!q) {
    return new Response(JSON.stringify({ error: "Query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    const { data: html } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const match = html.match(/"videoId":"([^"]+)"/);
    const videoId = match ? match[1] : null;
    
    return new Response(JSON.stringify({ 
      videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null 
    }), {
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
