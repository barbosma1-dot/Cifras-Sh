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
    const { images, prompt } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "Images are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is not defined in environment variables");
      return new Response(JSON.stringify({ error: "API Key not configured on server" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    
    // Using gemini-2.0-flash
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

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No response from AI");
    }

    // Basic cleaning in case of markdown blocks
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    return new Response(cleanJson, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("AI Extraction error:", error);
    let details = error.message;
    if (details.includes("quota") || details.includes("429") || details.includes("RESOURCE_EXHAUSTED")) {
      details = "Limite de uso gratuito da IA excedido. Por favor, aguarde alguns minutos antes de tentar novamente ou reduza o número de páginas extraídas.";
    }
    return new Response(JSON.stringify({ 
      error: "Falha na extração por IA", 
      details 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
