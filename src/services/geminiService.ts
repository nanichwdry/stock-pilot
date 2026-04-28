import { AIAnalysis } from "../types";

export async function analyzeStock(symbol: string, currentPrice: number): Promise<AIAnalysis> {
  try {
    const response = await fetch("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, currentPrice })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(JSON.stringify(errorData));
    }
    
    return await response.json();
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
    const response = await fetch("/api/ai/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol })
    });
    
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error("News fetch failed:", error);
    return [];
  }
}

export async function getVoiceGreeting(userName: string, portfolioSummary: string, marketStatus: string): Promise<string> {
  try {
    const response = await fetch("/api/ai/greeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName, portfolioSummary, marketStatus })
    });
    
    if (!response.ok) throw new Error("Failed to get greeting");
    const data = await response.json();
    return data.text || `Welcome back ${userName}. I'm Aria, your assistant. Let's look at the markets.`;
  } catch (error) {
    return `Welcome back ${userName}. Your portfolio is looking interesting today. How can I help?`;
  }
}


