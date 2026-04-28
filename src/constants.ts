import { Stock } from "./types";

export const INITIAL_WATCHLIST: Stock[] = [
  {
    symbol: "NVDA",
    name: "NVIDIA Corp",
    price: 124.52,
    change: 2.34,
    changePercent: 1.88,
    history: Array.from({ length: 20 }, (_, i) => ({
      time: `${i}:00`,
      price: 110 + Math.random() * 20
    }))
  },
  {
    symbol: "TSLA",
    name: "Tesla, Inc.",
    price: 175.22,
    change: -1.45,
    changePercent: -0.82,
    history: Array.from({ length: 20 }, (_, i) => ({
      time: `${i}:00`,
      price: 160 + Math.random() * 30
    }))
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    price: 189.43,
    change: 0.56,
    changePercent: 0.29,
    history: Array.from({ length: 20 }, (_, i) => ({
      time: `${i}:00`,
      price: 180 + Math.random() * 15
    }))
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    price: 64231.00,
    change: 1205.50,
    changePercent: 1.91,
    history: Array.from({ length: 20 }, (_, i) => ({
      time: `${i}:00`,
      price: 60000 + Math.random() * 5000
    }))
  }
];

export const TRADING_LINKS = [
  { name: "Robinhood", url: "https://robinhood.com", description: "Best for fractional shares." },
  { name: "Webull", url: "https://webull.com", description: "Great technical charts." },
  { name: "Public.com", url: "https://public.com", description: "Social investing & ETFs." },
  { name: "Vanguard", url: "https://vanguard.com", description: "Stability and long-term." }
];
