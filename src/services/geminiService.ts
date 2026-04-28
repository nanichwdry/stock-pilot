import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysis } from "../types";

let genAI: GoogleGenAI | null = null;

function getAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Please provide it in the environment variables.");
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

export async function analyzeStock(symbol: string, currentPrice: number): Promise<AIAnalysis> {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Perform a detailed technical and sentiment analysis for the stock symbol: ${symbol}. 
                 The current price is $${currentPrice}. 
                 The user is a beginner starting with a $20 budget. 
                 Provide a clear BUY, SELL, or HOLD recommendation.
                 Include reasoning, entry/exit/stop-loss targets, and overall sentiment.
                 Format the response as a JSON object matching the AIAnalysis interface.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendation: { type: Type.STRING, enum: ["BUY", "SELL", "HOLD"] },
            confidence: { type: Type.NUMBER, description: "Confidence score from 0 to 1" },
            reasoning: { type: Type.STRING },
            sentiment: { type: Type.STRING },
            targets: {
              type: Type.OBJECT,
              properties: {
                entry: { type: Type.NUMBER },
                exit: { type: Type.NUMBER },
                stopLoss: { type: Type.NUMBER }
              },
              required: ["entry", "exit", "stopLoss"]
            }
          },
          required: ["recommendation", "confidence", "reasoning", "sentiment", "targets"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    return JSON.parse(text) as AIAnalysis;
  } catch (error) {
    console.error("AI Analysis failed:", error);
    return {
      recommendation: 'HOLD',
      confidence: 0.5,
      reasoning: "Analysis temporarily unavailable. Please monitor market trends manually.",
      sentiment: "Neutral",
      targets: {
        entry: currentPrice,
        exit: currentPrice * 1.05,
        stopLoss: currentPrice * 0.95
      }
    };
  }
}

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  summary: string;
  publishedAt: string;
}

export async function getStockNews(symbol: string): Promise<NewsArticle[]> {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for the latest, most relevant news articles for stock symbol: ${symbol}. 
                 Provide a list of 5 news items including title, a short summary (1 sentence), the source name, and a relative timestamp (e.g., '2 hours ago').`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              url: { type: Type.STRING },
              source: { type: Type.STRING },
              summary: { type: Type.STRING },
              publishedAt: { type: Type.STRING }
            },
            required: ["title", "source", "summary", "publishedAt"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as NewsArticle[];
  } catch (error) {
    console.error("News fetch failed:", error);
    return [];
  }
}

export async function getVoiceGreeting(userName: string, portfolioSummary: string, marketStatus: string): Promise<string> {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are Aria, a friendly and professional personal stock assistant. 
                 Welcome ${userName} back to the trading floor.
                 Briefly summarize their day: ${portfolioSummary}.
                 Mention the current market mood: ${marketStatus}.
                 Keep it concise, supportive, and natural (personable).
                 Do not use markdown, just plain text suitable for text-to-speech.`,
    });
    return response.text || `Welcome back ${userName}. I'm Aria, your assistant. Let's look at the markets.`;
  } catch (error) {
    return `Welcome back ${userName}. Your portfolio is looking interesting today. How can I help?`;
  }
}


