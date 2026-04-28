export interface Stock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  history: { time: string; price: number }[];
}

export interface PortfolioItem {
  symbol: string;
  shares: number;
  averagePrice: number;
}

export interface Trade {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  shares: number;
  price: number;
  timestamp: string;
  isAutoTrade?: boolean;
}

export interface BotSettings {
  isEnabled: boolean;
  safeBalance: number;
  maxTradeAmount: number;
  riskTolerance: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  isDayTradeMode: boolean;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  condition: 'ABOVE' | 'BELOW';
  isTriggered: boolean;
}

export interface AIAnalysis {
  recommendation: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
  sentiment: string;
  targets: {
    entry: number;
    exit: number;
    stopLoss: number;
  };
}
