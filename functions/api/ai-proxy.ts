import { GoogleGenAI } from "@google/genai";

export const onRequestPost = async (context: any) => {
  const { request, env } = context;
  try {
    const body: any = await request.json();
    const { prompt, model, systemInstruction, responseMimeType } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API Key not configured on server (GEMINI_API_KEY)" }), {
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
        responseMimeType: responseMimeType || "text/plain",
        systemInstruction: systemInstruction
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
