import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Stripe from "stripe";
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const PORT = 3000;

// Initialize Firebase on server
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

// Lazy Gemini init
let genAI: GoogleGenAI | null = null;
function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  if (!genAI) {
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

// Lazy Stripe init
let stripeClient: Stripe | null = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(key, { apiVersion: "2023-10-16" as any });
  }
  return stripeClient;
}

app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https://*", "blob:"],
      "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://www.gstatic.com", "https://*.firebaseapp.com", "https://cdn.jsdelivr.net"],
      "script-src-elem": ["'self'", "'unsafe-inline'", "https://apis.google.com", "https://www.gstatic.com", "https://*.firebaseapp.com", "https://cdn.jsdelivr.net"],
      "frame-src": ["'self'", "https://*.firebaseapp.com", "https://*.auth.google.com", "https://*.google.com"],
      "connect-src": ["'self'", "https://*", "wss://*", "ws://localhost:*", "ws://127.0.0.1:*"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    },
  },
}));

// 2. Global Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});

app.use("/api/", globalLimiter);
app.use(express.json());

// --- TRADING CORE (Server Side) ---
let serverBalance = 20.00;

// --- API ROUTES ---

app.post("/api/ai/analyze", async (req, res) => {
  try {
    const { symbol, currentPrice } = req.body;
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
            confidence: { type: Type.NUMBER },
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
    res.json(JSON.parse(text || "{}"));
  } catch (err: any) {
    console.error("AI Analyze Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ai/news", async (req, res) => {
  try {
    const { symbol } = req.body;
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
    res.json(JSON.parse(response.text || "[]"));
  } catch (err: any) {
    console.error("AI News Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ai/greeting", async (req, res) => {
  try {
    const { userName, portfolioSummary, marketStatus } = req.body;
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
    res.json({ text: response.text });
  } catch (err: any) {
    console.error("AI Greeting Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/funds/create-checkout-session", async (req, res) => {
  const { amount, userId } = req.body;
  const stripe = getStripe();

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (!stripe) {
    // Fallback/Simulated flow if no Stripe key is provided
    return res.json({ 
      simulated: true,
      url: `${process.env.APP_URL || "http://localhost:3000"}/api/funds/simulated-success?amount=${amount}&userId=${userId}`
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      client_reference_id: userId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Stock Pilot Fund Deposit",
              description: "Add funds to your trading balance",
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.APP_URL || "http://localhost:3000"}/?payment=success&amount=${amount}`,
      cancel_url: `${process.env.APP_URL || "http://localhost:3000"}/?payment=cancel`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper for simulated success
app.get("/api/funds/simulated-success", async (req, res) => {
  const amount = parseFloat(req.query.amount as string || "0");
  const userId = req.query.userId as string;

  if (userId) {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        balance: increment(amount),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to update user balance in Firestore:", err);
    }
  }

  serverBalance += amount;
  res.redirect(`/?payment=success&amount=${amount}`);
});

app.get("/api/balance", (req, res) => {
  res.json({ balance: serverBalance });
});

app.post("/api/funds/deposit", (req, res) => {
  const { amount } = req.body;
  
  // 3. Input Validation
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount. Must be a positive number." });
  }
  
  if (amount > 1000000) { // Safety cap
    return res.status(400).json({ error: "Deposit limit exceeded for single transaction." });
  }

  serverBalance += amount;
  res.json({ success: true, balance: serverBalance });
});

app.post("/api/funds/withdraw", (req, res) => {
  const { amount } = req.body;

  // 3. Input Validation
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount. Must be a positive number." });
  }

  if (amount > serverBalance) {
    return res.status(400).json({ error: "Insufficient funds. Access denied." });
  }

  serverBalance -= amount;
  res.json({ success: true, balance: serverBalance });
});

// Real platform placeholders would go here:
// app.post("/api/execute/coinbase", async (req, res) => { ... });

// --- VITE MIDDLEWARE ---

async function startServer() {
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
    console.log(`[SERVER] Running at http://localhost:${PORT}`);
  });
}

startServer();
