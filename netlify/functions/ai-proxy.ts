import { Config, Context } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.json();
    const { prompt, model, systemInstruction, responseMimeType } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API Key not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    
    const response = await ai.models.generateContent({
      model: model || "gemini-3-flash-preview",
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: responseMimeType || "text/plain"
      }
    });

    const text = response.text;
    
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("AI Proxy error:", error);
    let details = error.message;
    if (details.includes("quota") || details.includes("429") || details.includes("RESOURCE_EXHAUSTED")) {
      details = "Limite de uso gratuito da IA excedido (Quota Exceeded). Por favor, aguarde alguns minutos antes de tentar novamente ou use uma chave de API paga.";
    }
    return new Response(JSON.stringify({ 
      error: "Erro no processamento da IA", 
      details 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
