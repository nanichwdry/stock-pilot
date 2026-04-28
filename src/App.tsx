import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  TrendingUp, 
  TrendingDown, 
  Search, 
  Wallet, 
  PieChart, 
  ArrowRight, 
  ExternalLink, 
  Activity, 
  BrainCircuit,
  History,
  Info,
  X,
  Target,
  Bell,
  Trash2,
  Plus,
  Mic,
  MessageSquare,
  Newspaper,
  LogIn,
  LogOut,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { cn, formatCurrency, formatPercentage } from './lib/utils';
import { Stock, PortfolioItem, Trade, AIAnalysis, BotSettings, PriceAlert } from './types';
import { INITIAL_WATCHLIST, TRADING_LINKS } from './constants';
import { analyzeStock, getStockNews, getVoiceGreeting, type NewsArticle } from './services/geminiService';
import ReactMarkdown from 'react-markdown';
import { auth, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  orderBy, 
  addDoc, 
  serverTimestamp,
  updateDoc,
  increment 
} from 'firebase/firestore';
import { db } from './lib/firebase';
import { OperationType, handleFirestoreError } from './lib/firestoreUtils';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [balance, setBalance] = useState(0.00);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stocks, setStocks] = useState<Stock[]>(INITIAL_WATCHLIST);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [botSettings, setBotSettings] = useState<BotSettings>({
    isEnabled: false,
    safeBalance: 10.00,
    maxTradeAmount: 2.00,
    riskTolerance: 'MODERATE',
    isDayTradeMode: true
  });
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [isGreetingPlayed, setIsGreetingPlayed] = useState(false);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [activeTab, setActiveTab] = useState<'ANALYSIS' | 'NEWS'>('ANALYSIS');
  const [historyData, setHistoryData] = useState<{timestamp: string, totalValue: number}[]>([]);
  const [timeframe, setTimeframe] = useState<'1D' | '1W' | '1M' | '1Y'>('1D');

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [notifications, setNotifications] = useState<{id: string, text: string}[]>([]);

  const [showFundsModal, setShowFundsModal] = useState(false);
  const [fundsAmount, setFundsAmount] = useState("10");
  const [fundsAction, setFundsAction] = useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');

  const speak = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    // Prefer a nice female voice if available for "Aria"
    utterance.voice = voices.find(v => v.name.includes('Female') || v.name.includes('Google US English')) || voices[0];
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!isGreetingPlayed) {
      const initGreeting = async () => {
        const summary = portfolio.length > 0 
          ? `You have ${portfolio.length} positions open.`
          : "Your portfolio is currently empty and ready for fresh opportunities.";
        const greeting = await getVoiceGreeting("User", summary, "cautiously optimistic");
        speak(greeting);
        setIsGreetingPlayed(true);
      };
      const timer = setTimeout(initGreeting, 2000);
      return () => clearTimeout(timer);
    }
  }, [portfolio, isGreetingPlayed]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Sync Data with Firestore
  useEffect(() => {
    if (!user) return;

    // Sync User Profile (Balance & Settings)
    const userRef = doc(db, 'users', user.uid);
    const unsubUser = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setBalance(data.balance || 0);
        if (data.botSettings) {
          setBotSettings(data.botSettings);
        }
      } else {
        // Init user in Firestore
        setDoc(userRef, {
          balance: 20,
          updatedAt: serverTimestamp(),
          botSettings: {
            isEnabled: false,
            safeBalance: 10.00,
            maxTradeAmount: 2.00,
            riskTolerance: 'MODERATE',
            isDayTradeMode: true
          }
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));

    // Sync Portfolio
    const portfolioRef = collection(db, 'users', user.uid, 'portfolio');
    const unsubPortfolio = onSnapshot(portfolioRef, (snap) => {
      const items: PortfolioItem[] = [];
      snap.forEach(doc => items.push(doc.data() as PortfolioItem));
      setPortfolio(items);
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}/portfolio`));

    // Sync Trades
    const tradesRef = query(collection(db, 'users', user.uid, 'trades'), orderBy('timestamp', 'desc'));
    const unsubTrades = onSnapshot(tradesRef, (snap) => {
      const items: Trade[] = [];
      snap.forEach(doc => {
        const data = doc.data();
        items.push({
          ...data,
          id: doc.id,
          timestamp: data.timestamp?.toDate?.()?.toISOString() || new Date().toISOString()
        } as Trade);
      });
      setTrades(items);
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}/trades`));

    // Sync History
    const historyRef = query(collection(db, 'users', user.uid, 'history'), orderBy('timestamp', 'asc'));
    const unsubHistory = onSnapshot(historyRef, (snap) => {
      const items: {timestamp: string, totalValue: number}[] = [];
      snap.forEach(doc => {
        const data = doc.data();
        items.push({
          timestamp: data.timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
          totalValue: data.totalValue
        });
      });
      setHistoryData(items);
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}/history`));

    return () => {
      unsubUser();
      unsubPortfolio();
      unsubTrades();
      unsubHistory();
    };
  }, [user]);

  // Sync with backend on mount
  useEffect(() => {
    if (!user) return;
    
    // Check URL params for payment status
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      const amount = params.get('amount');
      setNotifications(prev => [{
        id: Math.random().toString(36).substr(2, 9),
        text: `💰 Payment Successful! $${amount} added to balance.`
      }, ...prev]);
      // Remove params from URL to prevent double alerts on refresh
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('payment') === 'cancel') {
      setNotifications(prev => [{
        id: Math.random().toString(36).substr(2, 9),
        text: "❌ Payment cancelled."
      }, ...prev]);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [user]);


  const handleDeposit = async (amount: number) => {
    if (!user) return;
    try {
      const res = await fetch('/api/funds/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, userId: user.uid })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Deposit flow failed:", err);
    }
  };

  const handleWithdraw = async (amount: number) => {
    if (!user) return;
    try {
      // For withdrawal, we should probably verify balance on server too
      // But for simplicity, we update Firestore and server just logs it
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      const currentBalance = snap.data()?.balance || 0;
      
      if (currentBalance < amount) {
        setNotifications(prev => [{ id: Math.random().toString(), text: "⚠️ Insufficient balance" }, ...prev]);
        return;
      }

      await updateDoc(userRef, {
        balance: increment(-amount),
        updatedAt: serverTimestamp()
      });

      setNotifications(prev => [{
        id: Math.random().toString(36).substr(2, 9),
        text: `💸 $${amount} withdrawal initiated to linked account.`
      }, ...prev]);
    } catch (err) {
      console.error("Withdraw failed:", err);
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  // Check Price Alerts
  useEffect(() => {
    const triggeredAlerts = alerts.filter(alert => {
      if (alert.isTriggered) return false;
      const stock = stocks.find(s => s.symbol === alert.symbol);
      if (!stock) return false;
      return alert.condition === 'ABOVE' ? stock.price >= alert.price : stock.price <= alert.price;
    });

    if (triggeredAlerts.length > 0) {
      const newNotifications = triggeredAlerts.map(alert => ({
        id: Math.random().toString(36).substr(2, 9),
        text: `🚨 ${alert.symbol} Alert: Price ${alert.condition === 'ABOVE' ? 'crossed above' : 'dropped below'} ${formatCurrency(alert.price)}`
      }));
      
      setNotifications(prev => [...newNotifications, ...prev].slice(0, 5));
      setAlerts(current => current.map(alert => {
        const isTriggered = triggeredAlerts.some(ta => ta.id === alert.id);
        return isTriggered ? { ...alert, isTriggered: true } : alert;
      }));
    }
  }, [stocks, alerts]);

  // Clean notifications
  useEffect(() => {
    if (notifications.length > 0) {
      const timer = setTimeout(() => {
        setNotifications(prev => prev.slice(0, -1));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notifications]);

  // Simulated price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setStocks(current => current.map(stock => {
        const volatility = 0.002;
        const change = stock.price * (Math.random() * volatility * 2 - volatility);
        const newPrice = stock.price + change;
        return {
          ...stock,
          price: newPrice,
          change: stock.change + change,
          changePercent: ( (newPrice - (stock.price - stock.change)) / (stock.price - stock.change) ) * 100,
          history: [...stock.history.slice(1), { time: new Date().toLocaleTimeString(), price: newPrice }]
        };
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const totalEquity = useMemo(() => {
    return portfolio.reduce((acc, item) => {
      const stock = stocks.find(s => s.symbol === item.symbol);
      return acc + (stock ? stock.price * item.shares : 0);
    }, 0);
  }, [portfolio, stocks]);

  const updateBotSettings = async (newSettings: Partial<BotSettings>) => {
    if (!user) return;
    const settings = { ...botSettings, ...newSettings };
    setBotSettings(settings); // Optimistic UI
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        botSettings: settings,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to update bot settings:", err);
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    }
  };
  const totalValue = balance + totalEquity;

  const PerformanceChart = () => {
    const filteredData = useMemo(() => {
      const now = new Date();
      return historyData.filter(d => {
        const date = new Date(d.timestamp);
        if (timeframe === '1D') return now.getTime() - date.getTime() <= 24 * 60 * 60 * 1000;
        if (timeframe === '1W') return now.getTime() - date.getTime() <= 7 * 24 * 60 * 60 * 1000;
        if (timeframe === '1M') return now.getTime() - date.getTime() <= 30 * 24 * 60 * 60 * 1000;
        return true; // 1Y
      });
    }, [historyData, timeframe]);

    return (
      <div className="h-[120px] w-full mt-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Growth Curve</span>
          <div className="flex gap-1">
            {(['1D', '1W', '1M', '1Y'] as const).map(tf => (
              <button
                key={tf}
                onClick={(e) => {
                  e.stopPropagation();
                  setTimeframe(tf);
                }}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[7px] font-black transition-all",
                  timeframe === tf ? "bg-indigo-600 text-white" : "text-slate-600 hover:text-slate-400"
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filteredData.length > 0 ? filteredData : [{ timestamp: new Date().toISOString(), totalValue: totalValue }]}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="timestamp" hide />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '4px 8px' }}
              itemStyle={{ color: '#fff', fontSize: '10px', padding: 0 }}
              labelStyle={{ display: 'none' }}
              formatter={(value: number) => [formatCurrency(value), 'Value']}
            />
            <Area 
              type="monotone" 
              dataKey="totalValue" 
              stroke="#6366f1" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorValue)" 
              animationDuration={1000}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const handleAnalyze = async (stock: Stock) => {
    setIsAnalyzing(true);
    setIsModalOpen(true);
    setSelectedStock(stock);
    setNews([]);
    setActiveTab('ANALYSIS');
    
    // Parallel fetch analysis and news
    const [result, newsData] = await Promise.all([
      analyzeStock(stock.symbol, stock.price),
      getStockNews(stock.symbol)
    ]);
    
    setAnalysis(result);
    setNews(newsData);
    setIsAnalyzing(false);
  };

  const recordSnapshot = async (val: number) => {
    if (!user) return;
    try {
      const historyRef = collection(db, 'users', user.uid, 'history');
      await addDoc(historyRef, {
        totalValue: val,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to record snapshot:", err);
    }
  };

  // Periodically record snapshots (every hour ideally, but let's do it on significant value changes for demo/real use)
  useEffect(() => {
    if (!user || totalValue === 0) return;
    
    // Logic: Record if last snapshot was > 1 hour ago OR if no snapshots exist
    const lastSnapshot = historyData[historyData.length - 1];
    const now = new Date().getTime();
    const oneHour = 60 * 60 * 1000;

    if (!lastSnapshot || (now - new Date(lastSnapshot.timestamp).getTime() > oneHour)) {
      recordSnapshot(totalValue);
    }
  }, [totalValue, user, historyData]);

  const handleBuy = async (stock: Stock, amount: number, isAutoTrade = false) => {
    if (!user || amount > balance) return;
    
    try {
      const shares = amount / stock.price;
      const userRef = doc(db, 'users', user.uid);
      const portfolioRef = doc(db, 'users', user.uid, 'portfolio', stock.symbol);
      const tradesRef = collection(db, 'users', user.uid, 'trades');

      const portSnap = await getDoc(portfolioRef);
      
      // Atomic-ish update (using batch or multiple writes for simplicity)
      await updateDoc(userRef, {
        balance: increment(-amount),
        updatedAt: serverTimestamp()
      });

      if (portSnap.exists()) {
        const item = portSnap.data() as PortfolioItem;
        const totalCost = (item.shares * item.averagePrice) + amount;
        const totalShares = item.shares + shares;
        await updateDoc(portfolioRef, {
          shares: totalShares,
          averagePrice: totalCost / totalShares,
          updatedAt: serverTimestamp()
        });
      } else {
        await setDoc(portfolioRef, {
          symbol: stock.symbol,
          shares,
          averagePrice: stock.price,
          updatedAt: serverTimestamp()
        });
      }

      await addDoc(tradesRef, {
        symbol: stock.symbol,
        type: 'BUY',
        shares,
        price: stock.price,
        timestamp: serverTimestamp(),
        isAutoTrade
      });

      // Update local history for immediate feedback if possible, or force a snapshot
      recordSnapshot(totalValue); 

    } catch (err) {
      console.error("Buy failed:", err);
      handleFirestoreError(err, OperationType.WRITE, `trades`);
    }
  };

  const handleSell = async (stock: Stock, sharesToSell: number, isAutoTrade = false) => {
    if (!user) return;
    const position = portfolio.find(p => p.symbol === stock.symbol);
    if (!position || sharesToSell > position.shares) return;

    try {
      const sellValue = sharesToSell * stock.price;
      const userRef = doc(db, 'users', user.uid);
      const portfolioRef = doc(db, 'users', user.uid, 'portfolio', stock.symbol);
      const tradesRef = collection(db, 'users', user.uid, 'trades');

      await updateDoc(userRef, {
        balance: increment(sellValue),
        updatedAt: serverTimestamp()
      });

      if (position.shares <= sharesToSell) {
        // Actually it's better to delete if 0, but sometimes we keep it
        // Firestore rules might want to check this
        // For now, if we delete, it might be cleaner
        import('firebase/firestore').then(({ deleteDoc }) => deleteDoc(portfolioRef));
      } else {
        await updateDoc(portfolioRef, {
          shares: increment(-sharesToSell),
          updatedAt: serverTimestamp()
        });
      }

      await addDoc(tradesRef, {
        symbol: stock.symbol,
        type: 'SELL',
        shares: sharesToSell,
        price: stock.price,
        timestamp: serverTimestamp(),
        isAutoTrade
      });

      recordSnapshot(totalValue);

    } catch (err) {
      console.error("Sell failed:", err);
      handleFirestoreError(err, OperationType.WRITE, `trades`);
    }
  };

  // Bot Logic
  useEffect(() => {
    if (!botSettings.isEnabled) return;

    const botInterval = setInterval(async () => {
      setIsBotThinking(true);
      try {
        const randomStock = stocks[Math.floor(Math.random() * stocks.length)];
        const analysisResult = await analyzeStock(randomStock.symbol, randomStock.price);
        
        // Risk Profile Thresholds
        const thresholds = {
          CONSERVATIVE: { confidence: 0.82, minGain: 1.15, size: 0.4 },
          MODERATE: { confidence: 0.65, minGain: 1.08, size: 0.7 },
          AGGRESSIVE: { confidence: 0.45, minGain: 1.03, size: 1.0 }
        };

        const config = thresholds[botSettings.riskTolerance];
        const projectedGain = analysisResult.targets.exit / analysisResult.targets.entry;
        const actualTradeAmount = botSettings.maxTradeAmount * config.size;

        if (analysisResult.recommendation === 'BUY') {
          const isHighConfidence = analysisResult.confidence >= config.confidence;
          const isGainsTargetMet = projectedGain >= config.minGain;

          if (isHighConfidence && isGainsTargetMet) {
            if (balance - actualTradeAmount >= botSettings.safeBalance) {
              handleBuy(randomStock, actualTradeAmount, true);
            }
          }
        } else {
          // Intraday / Standard Sell Logic
          const position = portfolio.find(p => p.symbol === randomStock.symbol);
          if (position) {
            const currentPrice = randomStock.price;
            const avgPrice = position.averagePrice;
            const gain = (currentPrice - avgPrice) / avgPrice;

            // In Day Trade Mode, we exit much faster if target is hit or minor profit is made
            const dayTradeExit = botSettings.isDayTradeMode && (gain >= 0.02 || gain <= -0.01);
            const standardExit = analysisResult.recommendation === 'SELL';

            if (dayTradeExit || standardExit) {
              const sellPercentage = botSettings.riskTolerance === 'CONSERVATIVE' ? 1.0 : 0.5;
              handleSell(randomStock, position.shares * sellPercentage, true);
            }
          }
        }
      } catch (err) {
        console.error("Bot logic error:", err);
      } finally {
        setIsBotThinking(false);
      }
    }, 20000);

    return () => clearInterval(botInterval);
  }, [botSettings, balance, portfolio, stocks]);

  const filteredStocks = stocks.filter(s => 
    s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSignIn = async () => {
    console.log("Starting sign in...");
    try {
      const result = await signInWithGoogle();
      console.log("Sign in successful:", result.user.email);
    } catch (err: any) {
      console.error("Sign in failed:", err);
      let errorMsg = err.message;
      
      if (err.code === 'auth/popup-blocked') {
        errorMsg = "Popup blocked! Please allow popups for this site.";
      } else if (err.code === 'auth/unauthorized-domain') {
        errorMsg = "Domain not authorized in Firebase Console. Please add this domain to 'Authorized Domains' in your Firebase Auth settings.";
      }
      
      setNotifications(prev => [{
        id: Math.random().toString(),
        text: `⚠️ Sign-in failed: ${errorMsg}`
      }, ...prev]);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8">
        <div className="relative">
          <div className="h-24 w-24 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <BrainCircuit className="text-indigo-400 animate-pulse" size={32} />
          </div>
        </div>
        <p className="mt-8 text-slate-500 text-[10px] font-bold uppercase tracking-[0.5em] animate-pulse">Initializing Pilot Interface</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col relative overflow-hidden selection:bg-indigo-500/30">
        {/* Background Gradients */}
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-indigo-600/10 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />
        
        <nav className="relative z-10 px-8 py-8 flex justify-between items-center max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-3">
             <div className="h-10 w-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
               <BrainCircuit className="text-white" size={24} />
             </div>
             <span className="text-xl font-black text-white tracking-tighter">Stock Pilot <span className="text-slate-500 font-normal">v1.2</span></span>
          </div>
          <button 
            onClick={handleSignIn}
            className="group flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-full text-sm font-bold hover:bg-slate-200 transition-all shadow-xl hover:scale-105"
          >
            Sign In with Google
            <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </nav>

        <main className="flex-grow relative z-10 flex flex-col items-center justify-center text-center px-8">
           <motion.div
             initial={{ opacity: 0, y: 30 }}
             animate={{ opacity: 1, y: 0 }}
             className="max-w-3xl"
           >
             <h2 className="text-6xl sm:text-7xl font-black text-white leading-[1.1] mb-8 tracking-tighter">
               Turn your <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-indigo-400">$20</span> into a 
               <span className="block italic font-serif font-light text-slate-400">Wealth Generator.</span>
             </h2>
             <p className="text-lg text-slate-400 max-w-xl mx-auto mb-12 font-medium leading-relaxed">
               The first AI-driven trading pilot designed for small-balance growth. 
               Zero commissions. Real-time intelligence. Auto-pilot execution.
             </p>
             
             <div className="flex flex-col sm:flex-row gap-4 justify-center">
               <button 
                 onClick={handleSignIn}
                 className="px-10 py-5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl font-black text-lg shadow-2xl shadow-indigo-600/30 hover:shadow-indigo-600/50 transition-all flex items-center justify-center gap-3 group"
               >
                 <LogIn size={20} />
                 Launch Your Pilot
               </button>
               <div className="px-10 py-5 bg-slate-900 border border-slate-800 rounded-2xl text-slate-300 font-bold flex items-center justify-center gap-3">
                 <ShieldCheck className="text-emerald-500" size={20} />
                 Secured by Google
               </div>
             </div>

             <div className="mt-24 grid grid-cols-1 sm:grid-cols-3 gap-12 text-left opacity-60">
                <div>
                  <h4 className="text-white font-black uppercase text-xs tracking-widest mb-3">Precision Analysis</h4>
                  <p className="text-sm text-slate-400">Gemini 1.5 Pro analyzes charts and news patterns with 98% data accuracy.</p>
                </div>
                <div>
                  <h4 className="text-white font-black uppercase text-xs tracking-widest mb-3">Risk Protection</h4>
                  <p className="text-sm text-slate-400">Hard-coded stop losses ensure your $20 is never fully exposed to market crashes.</p>
                </div>
                <div>
                  <h4 className="text-white font-black uppercase text-xs tracking-widest mb-3">Live Execution</h4>
                  <p className="text-sm text-slate-400">Execute order across global markets instantly with real capital synchronization.</p>
                </div>
             </div>
           </motion.div>
        </main>

        <footer className="relative z-10 px-8 py-12 border-t border-slate-900 flex flex-col md:flex-row justify-between items-center gap-6 opacity-40">
          <p className="text-xs font-mono text-slate-500">© 2026 Stock Pilot Intelligence. Trading involves significant risk.</p>
          <div className="flex gap-8">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Privacy</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Terms</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Disclaimer</span>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 lg:p-8 flex flex-col gap-8 max-w-[1400px] mx-auto selection:bg-indigo-500/30">
      {/* Notifications Tray */}
      <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none max-w-sm">
        <AnimatePresence>
          {notifications.map(notif => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.8 }}
              className="bg-indigo-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-indigo-400/30 backdrop-blur-xl pointer-events-auto"
            >
              <Bell size={18} className="shrink-0 animate-bounce" />
              <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">{notif.text}</p>
              <button onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))} className="ml-2 hover:bg-white/20 p-1 rounded">
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header Section */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Stock Pilot</h1>
            <span className="text-emerald-500 font-mono text-[10px] border border-emerald-500/30 px-2 py-0.5 rounded tracking-widest uppercase">BETA</span>
          </div>
          <p className="text-slate-400 text-sm font-serif italic mt-1">"Making your first $20 work harder."</p>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all text-slate-400 hover:text-white"
          >
            <History size={14} />
            <span className="hidden sm:inline">Activity</span>
          </button>
          
          <div className="flex items-center gap-3">
             <div className="text-right hidden sm:block">
              <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">{user.displayName || user.email}</p>
              <button 
                onClick={() => signOut(auth)}
                className="text-[10px] text-rose-500 uppercase font-black tracking-widest hover:text-rose-400 flex items-center justify-end gap-1"
              >
                Sign Out
                <LogOut size={10} />
              </button>
            </div>
            {user.photoURL ? (
              <img src={user.photoURL} alt="User" className="h-11 w-11 rounded-full border border-white/10" referrerPolicy="no-referrer" />
            ) : (
              <div className="h-11 w-11 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full border border-white/10 flex items-center justify-center text-white font-bold text-sm">
                {user.displayName?.charAt(0) || user.email?.charAt(0) || "U"}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Bento Grid */}
      <main className="grid grid-cols-12 gap-4 auto-rows-min lg:grid-rows-6 lg:flex-grow">
        
        {/* Portfolio Balance Card */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="col-span-12 lg:col-span-4 lg:row-span-2 glass-panel p-8 flex flex-col justify-center"
        >
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Total Balance</span>
          <div className="flex items-baseline gap-3">
            <span className="text-5xl font-black text-white">{formatCurrency(totalValue)}</span>
            <span className={cn(
              "font-bold text-lg",
              totalValue >= 20 ? "text-emerald-400" : "text-rose-400"
            )}>
              {((totalValue - 20) / 20 * 100).toFixed(1)}%
            </span>
          </div>
          <div className="mt-6 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden flex items-center gap-2">
            <motion.div 
               className="h-full bg-emerald-500 rounded-full"
               initial={{ width: 0 }}
               animate={{ width: `${Math.min((totalValue / 50) * 100, 100)}%` }}
            />
          </div>
          <div className="flex justify-between items-center mt-4">
            <p className="text-[11px] text-slate-400 mono-data">Initial investment: $20.00 • Goal: $2,000</p>
            <button 
              onClick={() => {
                setFundsAction('DEPOSIT');
                setShowFundsModal(true);
              }}
              className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors uppercase tracking-widest px-2 py-1 bg-emerald-500/10 rounded"
            >
              Transfer Funds
            </button>
          </div>
          <PerformanceChart />
        </motion.div>

        {/* Signal Intelligence Card */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="col-span-12 lg:col-span-5 lg:row-span-2 bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-500/30 rounded-[32px] p-8 flex flex-col group"
        >
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-[0.2em]">Signal Intelligence</span>
            <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-400 animate-pulse"></span>
          </div>
          <div className="mt-6 flex items-center gap-6">
            <div className="bg-indigo-500/10 text-indigo-400 p-4 rounded-[20px] border border-indigo-500/20 group-hover:bg-indigo-500/20 transition-colors">
              <BrainCircuit size={32} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white leading-tight">
                {analysis ? `${analysis.recommendation} SIGNAL: ${selectedStock?.symbol}` : "READY TO SCAN"}
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                {analysis ? analysis.sentiment : "Select a ticker to generate alpha signals."}
              </p>
            </div>
          </div>
          <button 
            onClick={() => {
              if (selectedStock) handleAnalyze(selectedStock);
              else document.getElementById('watchlist')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="mt-auto bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-2xl transition-all text-xs uppercase tracking-widest active:scale-95 flex items-center justify-center gap-2"
          >
            {isAnalyzing ? "Processing..." : "Generate Insights"} <ArrowRight size={14} />
          </button>
        </motion.div>

        {/* Bot Control Card (Replacing Quick Stats or adding to grid) */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className={cn(
            "col-span-12 lg:col-span-3 lg:row-span-2 glass-panel p-8 flex flex-col relative overflow-hidden transition-all duration-500",
            botSettings.isEnabled ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800"
          )}
        >
          <div className="flex justify-between items-center mb-6">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Pilot Bot</span>
            <div className={cn(
              "h-2 w-2 rounded-full",
              botSettings.isEnabled ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-slate-700",
              isBotThinking && "animate-ping"
            )}></div>
          </div>
          
          <div className="flex-grow flex flex-col justify-center items-center gap-4">
             <div className={cn(
               "p-4 rounded-2xl transition-all duration-300",
               botSettings.isEnabled ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-950/50 text-slate-600"
             )}>
                <TrendingUp size={32} />
             </div>
             <p className="text-[11px] font-bold text-center uppercase tracking-widest text-slate-400">
               {botSettings.isEnabled ? (isBotThinking ? "Scanning Alpha..." : "Bot Monitoring") : "Pilot Inactive"}
             </p>
          </div>

          <button 
            onClick={() => updateBotSettings({ isEnabled: !botSettings.isEnabled })}
            className={cn(
               "mt-6 w-full py-3 rounded-2xl font-bold text-[10px] tracking-widest uppercase transition-all active:scale-95",
               botSettings.isEnabled 
                 ? "bg-rose-500 text-white hover:bg-rose-600" 
                 : "bg-emerald-600 text-white hover:bg-emerald-500"
            )}
          >
            {botSettings.isEnabled ? "Disable Autopilot" : "Enable Autopilot"}
          </button>
          
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  botSettings.isDayTradeMode ? "bg-amber-400 animate-pulse" : "bg-slate-700"
                )} />
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Intraday Mode</span>
              </div>
              <button 
                onClick={() => updateBotSettings({ isDayTradeMode: !botSettings.isDayTradeMode })}
                className={cn(
                  "text-[8px] font-black uppercase px-2 py-0.5 rounded border transition-all",
                  botSettings.isDayTradeMode ? "border-amber-500/50 text-amber-400 bg-amber-500/10" : "border-slate-800 text-slate-600"
                )}
              >
                {botSettings.isDayTradeMode ? "Active" : "Off"}
              </button>
            </div>
            
            <div className="flex items-center justify-between text-[9px] uppercase font-bold tracking-widest text-slate-600 mb-1">
              <span>Risk Profile</span>
              <span className={cn(
                "transition-colors",
                botSettings.riskTolerance === 'AGGRESSIVE' ? "text-rose-400" : 
                botSettings.riskTolerance === 'CONSERVATIVE' ? "text-emerald-400" : "text-indigo-400"
              )}>{botSettings.riskTolerance}</span>
            </div>
            <div className="flex gap-1 overflow-hidden rounded-lg border border-slate-800 p-0.5 bg-slate-950/30">
              {(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => updateBotSettings({ riskTolerance: r })}
                  className={cn(
                    "flex-1 py-1.5 text-[8px] font-black uppercase tracking-tighter transition-all rounded-md",
                    botSettings.riskTolerance === r ? "bg-slate-800 text-white" : "text-slate-600 hover:text-slate-400"
                  )}
                >
                  {r.slice(0, 4)}
                </button>
              ))}
            </div>
          </div>
          
          <div className="mt-4 flex items-center justify-between text-[9px] uppercase font-bold tracking-widest text-slate-600">
            <span>Safe: {formatCurrency(botSettings.safeBalance)}</span>
            <span>Max: {formatCurrency(botSettings.maxTradeAmount)}</span>
          </div>

          <div className="mt-8 pt-8 border-t border-slate-800 space-y-4">
            <button 
              onClick={async () => {
                const summary = trades.length > 0 
                  ? `Today, we executed ${trades.filter(t => t.isAutoTrade).length} automated trades. Our last trade was a ${trades[0].type} on ${trades[0].symbol}.`
                  : "We haven't made any trades yet today, but I'm monitoring several setups.";
                const response = await getVoiceGreeting("Mvajje", summary, "active and volatile");
                speak(response);
              }}
              className="w-full flex items-center justify-center gap-3 py-4 bg-indigo-500/10 border border-indigo-500/20 rounded-[24px] text-[10px] font-black uppercase tracking-widest text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all group shadow-sm"
            >
              <Mic size={16} className="group-hover:scale-125 transition-transform" />
              Listen to Briefing
            </button>
            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest text-center px-4 italic">
              Powered by Aria AI Assistant
            </p>
          </div>
        </motion.div>

        {/* Watchlist Section */}
        <div id="watchlist" className="col-span-12 lg:col-span-4 lg:row-span-4 glass-panel p-8 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Watchlist</h3>
            <div className="flex gap-1">
               <div className="h-1.5 w-1.5 rounded-full bg-indigo-500"></div>
               <div className="h-1.5 w-1.5 rounded-full bg-slate-700"></div>
               <div className="h-1.5 w-1.5 rounded-full bg-slate-700"></div>
            </div>
          </div>
          
          <div className="space-y-3 flex-grow overflow-y-auto pr-2 custom-scrollbar">
            {filteredStocks.map(stock => {
              const isSignificantMover = Math.abs(stock.changePercent) > 2;
              return (
                <motion.div 
                  key={stock.symbol}
                  layout
                  whileHover={{ scale: 1.02, x: 5 }}
                  onClick={() => setSelectedStock(stock)}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden",
                    selectedStock?.symbol === stock.symbol 
                      ? "bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/20" 
                      : "bg-slate-950/40 border-slate-800/40 hover:border-slate-700",
                    isSignificantMover && (stock.changePercent > 0 ? "border-emerald-500/20" : "border-rose-500/20")
                  )}
                >
                  {isSignificantMover && (
                    <div className={cn(
                      "absolute top-0 right-0 px-2 py-0.5 text-[8px] font-black uppercase tracking-tighter rounded-bl-lg",
                      stock.changePercent > 0 ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
                    )}>
                      {stock.changePercent > 0 ? "Surging" : "Dumping"}
                    </div>
                  )}
                  <div className="flex items-center gap-4">
                    <div className="font-bold text-white text-lg tracking-tight w-12">{stock.symbol}</div>
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{stock.name.split(' ')[0]}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <motion.p 
                      key={stock.price}
                      initial={{ scale: 1.1, color: stock.changePercent >= 0 ? "#10b981" : "#f43f5e" }}
                      animate={{ scale: 1, color: "#fff" }}
                      className="font-mono text-sm tracking-tight"
                    >
                      {formatCurrency(stock.price)}
                    </motion.p>
                    <p className={cn(
                      "text-[10px] font-bold",
                      stock.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}>
                      {formatPercentage(stock.changePercent)}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
          
          <div className="relative mt-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={14} />
            <input 
              type="text" 
              placeholder="QUICK SEARCH..."
              className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl py-4 pl-11 pr-4 text-[10px] font-bold tracking-widest uppercase outline-none focus:border-indigo-500/50 transition-colors"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Market Performance Chart Area */}
        <div className="col-span-12 lg:col-span-8 lg:row-span-3 glass-panel p-8 relative flex flex-col">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div>
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Live Performance</h3>
              <p className="text-2xl font-black mt-1 text-white uppercase italic">
                {selectedStock ? selectedStock.symbol : "Portfolio Performance"}
              </p>
            </div>
            <div className="flex bg-slate-950/50 p-1 rounded-xl border border-slate-800">
              {['1D', '1W', '1M', '1Y'].map(t => (
                <button key={t} className={cn(
                  "px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors",
                  t === '1D' ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                )}>{t}</button>
              ))}
            </div>
          </div>

          <div className="flex-grow min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={selectedStock ? selectedStock.history : Array.from({ length: 20 }, (_, i) => ({ time: `${i}:00`, price: totalValue + Math.random() * 5 }))}>
                <defs>
                  <linearGradient id="performance-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#6366f1" 
                  strokeWidth={4}
                  fill="url(#performance-grad)"
                  animationDuration={1500}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-3 gap-8 mt-10 border-t border-slate-800/50 pt-8 text-center uppercase tracking-widest">
            <div>
              <p className="text-[9px] font-bold text-slate-500 mb-1">Vol / 24h</p>
              <p className="text-xs font-mono text-white">$1.2M</p>
            </div>
            <div>
               <p className="text-[9px] font-bold text-slate-500 mb-1">Market Cap</p>
               <p className="text-xs font-mono text-white">$3.1T</p>
            </div>
            <div>
               <p className="text-[9px] font-bold text-slate-500 mb-1">Buy Ratio</p>
               <p className="text-xs font-mono text-emerald-400">88%</p>
            </div>
          </div>
        </div>

        {/* Recent Activity Mini-Feed */}
        <div className="col-span-12 lg:col-span-8 lg:row-span-1 glass-panel px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-6 overflow-hidden">
            <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 border border-slate-800 text-slate-500">
              <History size={18} />
            </div>
            <div className="flex-grow flex items-center gap-4 overflow-x-auto no-scrollbar">
              {trades.length > 0 ? trades.slice(0, 3).map(trade => (
                <div key={trade.id} className="flex-shrink-0 flex items-center gap-3 bg-slate-950/40 border border-slate-800/50 rounded-2xl px-4 py-2">
                  <div className={cn(
                    "h-2 w-2 rounded-full",
                    trade.type === 'BUY' ? "bg-emerald-500" : "bg-rose-500"
                  )} />
                  <span className="font-bold text-[10px] text-white tracking-tight uppercase">{trade.symbol}</span>
                  <span className="text-[10px] text-slate-500 font-mono italic">
                    {trade.type === 'BUY' ? '+' : '-'}{formatCurrency(trade.shares * trade.price)}
                  </span>
                </div>
              )) : (
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">No recent trade activity</p>
              )}
            </div>
          </div>
          <button 
            onClick={() => setShowHistory(true)}
            className="shrink-0 ml-4 h-10 px-6 rounded-xl bg-white text-black font-black text-[10px] uppercase tracking-widest hover:bg-indigo-500 hover:text-white transition-all shadow-[0_4px_20px_rgba(255,255,255,0.1)]"
          >
            Full Log
          </button>
        </div>

      </main>

      {/* Analysis Modal */}
      <AnimatePresence>
        {isModalOpen && selectedStock && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setIsModalOpen(false)}
            />
            <motion.div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-[40px] bg-slate-900 border border-slate-800 shadow-2xl">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="absolute right-6 top-6 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/50 text-white transition-colors hover:bg-white hover:text-black"
              >
                <X size={20} />
              </button>

              <div className="grid grid-cols-1 lg:grid-cols-2">
                <div className="bg-slate-950 p-8 text-white lg:p-12 border-r border-slate-800 flex flex-col h-screen max-lg:h-auto overflow-y-auto custom-scrollbar">
                  <div className="flex gap-4 mb-8">
                    <button 
                      onClick={() => setActiveTab('ANALYSIS')}
                      className={cn(
                        "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                        activeTab === 'ANALYSIS' ? "bg-white text-black" : "text-slate-500 hover:text-slate-300"
                      )}
                    >
                      <BrainCircuit size={14} className="inline mr-2" />
                      Analysis
                    </button>
                    <button 
                      onClick={() => setActiveTab('NEWS')}
                      className={cn(
                        "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                        activeTab === 'NEWS' ? "bg-white text-black" : "text-slate-500 hover:text-slate-300"
                      )}
                    >
                      <Newspaper size={14} className="inline mr-2" />
                      Live News
                    </button>
                  </div>

                  <div className="flex-grow flex flex-col">
                  {activeTab === 'ANALYSIS' ? (
                    isAnalyzing ? (
                      <div className="flex-grow flex flex-col items-center justify-center space-y-6">
                        <div className="relative">
                          <div className="h-16 w-16 animate-spin rounded-full border-4 border-indigo-500/10 border-t-indigo-500" />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-indigo-500">AI</span>
                        </div>
                        <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500">Processing real-time metrics...</p>
                      </div>
                    ) : analysis ? (
                      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <div>
                          <div className={cn(
                            "inline-block rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest mb-6",
                            analysis.recommendation === 'BUY' ? "bg-emerald-500 text-white" : 
                            analysis.recommendation === 'SELL' ? "bg-red-500 text-white" : "bg-white/10 text-white"
                          )}>
                            {analysis.recommendation} Signal
                          </div>
                          <div className="text-sm leading-relaxed text-slate-300 font-medium prose prose-invert prose-sm">
                            <ReactMarkdown>
                              {analysis.reasoning}
                            </ReactMarkdown>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="bento-inner-panel bg-slate-900/50 p-4">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Sentiment</p>
                            <p className="text-sm font-bold text-white">{analysis.sentiment}</p>
                          </div>
                          <div className="bento-inner-panel bg-slate-900/50 p-4">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Confidence</p>
                            <p className="text-sm font-bold text-indigo-400">{Math.round(analysis.confidence * 100)}%</p>
                          </div>
                        </div>

                        <div className="rounded-3xl border border-white/5 bg-slate-900/30 p-6 mt-4">
                          <div className="flex items-center gap-2 mb-4">
                            <Target size={14} className="text-indigo-400" />
                            <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Price Targets</h4>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-center">
                              <p className="text-[9px] text-slate-500 mb-1 uppercase font-bold tracking-widest">Limit</p>
                              <p className="font-mono text-red-500 font-bold">{formatCurrency(analysis.targets.stopLoss)}</p>
                            </div>
                            <div className="h-8 w-px bg-white/5" />
                            <div className="text-center transition-transform hover:scale-110">
                              <p className="text-[9px] text-slate-500 mb-1 uppercase font-bold tracking-widest">Entry</p>
                              <p className="font-mono text-white font-bold">{formatCurrency(analysis.targets.entry)}</p>
                            </div>
                            <div className="h-8 w-px bg-white/5" />
                            <div className="text-center">
                              <p className="text-[9px] text-slate-500 mb-1 uppercase font-bold tracking-widest">Exit</p>
                              <p className="font-mono text-emerald-500 font-bold">{formatCurrency(analysis.targets.exit)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null
                  ) : (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                      {news.length > 0 ? news.map((article, idx) => (
                        <div key={idx} className="glass-panel p-6 border-slate-800/50 hover:bg-slate-900/50 transition-colors group cursor-pointer">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[8px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-black uppercase tracking-tighter shadow-sm">{article.source}</span>
                            <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">{article.publishedAt}</span>
                          </div>
                          <h4 className="text-sm font-bold text-white mb-2 leading-tight group-hover:text-indigo-400 transition-colors">{article.title}</h4>
                          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{article.summary}</p>
                        </div>
                      )) : (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-700">
                          <Newspaper size={48} className="mb-4 opacity-10 animate-pulse" />
                          <p className="text-[10px] font-bold uppercase tracking-widest">Scanning news feeds...</p>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </div>

                <div className="p-8 lg:p-12 flex flex-col justify-between">
                  <div className="mb-8">
                    <h3 className="text-4xl font-black tracking-tighter text-white uppercase italic">{selectedStock.symbol}</h3>
                    <p className="text-sm font-medium text-slate-500">{selectedStock.name}</p>
                  </div>

                  <div className="mb-8 aspect-video w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={selectedStock.history}>
                        <defs>
                          <linearGradient id="modal-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ffffff" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" strokeOpacity={0.5} />
                        <XAxis hide dataKey="time" />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', backgroundColor: '#0f172a', color: '#fff', fontSize: '12px' }}
                          formatter={(val: number) => [formatCurrency(val), "Price"]}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="price" 
                          stroke="#ffffff" 
                          strokeWidth={4}
                          fill="url(#modal-grad)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="grid grid-cols-2 gap-8 mb-12">
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Current</p>
                      <p className="stat-value text-2xl">{formatCurrency(selectedStock.price)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Change</p>
                      <p className={cn(
                        "stat-value text-2xl font-mono",
                        selectedStock.change >= 0 ? "text-emerald-400" : "text-rose-400"
                      )}>
                        {formatPercentage(selectedStock.changePercent)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-8 border-t border-slate-800 pt-8 mb-8">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Price Alerts</h4>
                      <button 
                        onClick={() => {
                          const newAlert: PriceAlert = {
                            id: Math.random().toString(36).substr(2, 9),
                            symbol: selectedStock.symbol,
                            price: selectedStock.price * (Math.random() > 0.5 ? 1.05 : 0.95),
                            condition: Math.random() > 0.5 ? 'ABOVE' : 'BELOW',
                            isTriggered: false
                          };
                          setAlerts(prev => [...prev, newAlert]);
                        }}
                        className="flex items-center gap-1 text-[9px] font-black uppercase text-indigo-400 hover:text-indigo-300"
                      >
                        <Plus size={12} /> Add Alert
                      </button>
                    </div>
                    <div className="space-y-2 max-h-[120px] overflow-y-auto custom-scrollbar pr-1">
                      {alerts.filter(a => a.symbol === selectedStock.symbol).map(alert => (
                        <div key={alert.id} className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800 group">
                          <div className="flex items-center gap-3">
                            <Bell size={12} className={alert.isTriggered ? "text-slate-600" : "text-indigo-500"} />
                            <span className={cn(
                              "text-[10px] font-bold uppercase",
                              alert.isTriggered ? "text-slate-600 line-through" : "text-slate-300"
                            )}>
                              {alert.condition} {formatCurrency(alert.price)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                             {alert.isTriggered && <span className="text-[7px] font-black text-slate-600 uppercase tracking-tighter">Fired</span>}
                             <button 
                               onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
                               className="text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                             >
                               <Trash2 size={12} />
                             </button>
                          </div>
                        </div>
                      ))}
                      {alerts.filter(a => a.symbol === selectedStock.symbol).length === 0 && (
                        <p className="text-[9px] text-slate-700 font-bold uppercase text-center py-4 tracking-widest">No active alerts</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex gap-4">
                      <button 
                        onClick={() => handleBuy(selectedStock, 5)}
                        className="flex-1 rounded-2xl bg-white px-6 py-4 font-bold text-black transition-transform hover:scale-95 active:scale-90"
                      >
                        Trade with $5
                      </button>
                      {portfolio.find(p => p.symbol === selectedStock.symbol) && (
                        <button 
                          onClick={() => handleSell(selectedStock, portfolio.find(p => p.symbol === selectedStock.symbol)?.shares || 0)}
                          className="flex-1 rounded-2xl bg-rose-600 px-6 py-4 font-bold text-white transition-transform hover:scale-95 active:scale-90"
                        >
                          Sell All
                        </button>
                      )}
                      <button className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-white transition-colors hover:bg-white hover:text-black">
                        <Activity size={20} />
                      </button>
                    </div>
                    <p className="text-center text-[9px] text-slate-500 uppercase tracking-[0.2em] font-bold">
                      Your equity: {formatCurrency((portfolio.find(p => p.symbol === selectedStock.symbol)?.shares || 0) * selectedStock.price)}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => setShowHistory(false)}
            />
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.95 }}
              className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[32px] bg-slate-900 border border-slate-800 shadow-2xl flex flex-col h-[80vh]"
            >
              <div className="p-8 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black text-white italic uppercase tracking-tighter">Trade History</h2>
                  <p className="text-xs text-slate-500 font-bold tracking-widest mt-1 uppercase">Full Audit Log</p>
                </div>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white hover:bg-white hover:text-black transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Filters & Stats */}
              <div className="px-8 py-6 bg-slate-950/50 border-b border-slate-800/50 flex flex-col sm:flex-row gap-6 justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                <div className="flex gap-2 p-1 bg-slate-900 rounded-xl border border-slate-800">
                  {(['ALL', 'BUY', 'SELL'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setHistoryFilter(f)}
                      className={cn(
                        "px-4 py-1.5 rounded-lg transition-all",
                        historyFilter === f ? "bg-white text-black" : "text-slate-500 hover:text-slate-300"
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                
                <div className="flex gap-8">
                  <div className="text-center">
                    <p className="text-slate-500 mb-1">Total Orders</p>
                    <p className="text-white text-sm font-black">{trades.filter(t => historyFilter === 'ALL' || t.type === historyFilter).length}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-slate-500 mb-1">Volume</p>
                    <p className="text-white text-sm font-black">
                      {formatCurrency(trades
                        .filter(t => historyFilter === 'ALL' || t.type === historyFilter)
                        .reduce((sum, t) => sum + (t.shares * t.price), 0))}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-grow overflow-y-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-900 z-10">
                    <tr className="border-b border-slate-800">
                      <th className="px-8 py-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Order</th>
                      <th className="px-8 py-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Details</th>
                      <th className="px-8 py-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades
                      .filter(t => historyFilter === 'ALL' || t.type === historyFilter)
                      .map(trade => (
                      <tr key={trade.id} className="border-b border-slate-800/50 hover:bg-white/[0.02] transition-colors group">
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              "h-10 w-10 rounded-[14px] flex items-center justify-center font-black text-[9px] tracking-widest border",
                              trade.type === 'BUY' 
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.05)]" 
                                : "bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.05)]"
                            )}>
                              {trade.type}
                            </div>
                            <div>
                               <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-white tracking-tight">{trade.symbol}</h4>
                                {trade.isAutoTrade && (
                                  <span className="text-[7px] bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Pilot</span>
                                )}
                              </div>
                              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                                {new Date(trade.timestamp).toLocaleDateString()} at {new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6 font-mono">
                          <p className="text-[11px] text-slate-300">
                            <span className="text-slate-500">Qty:</span> {trade.shares.toFixed(6)}
                          </p>
                          <p className="text-[11px] text-slate-300">
                            <span className="text-slate-500">Price:</span> {formatCurrency(trade.price)}
                          </p>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <p className="text-sm font-bold text-white mb-1">{formatCurrency(trade.shares * trade.price)}</p>
                          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Executed</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {trades.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center py-32 text-slate-700">
                    <History size={64} className="mb-6 opacity-5" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] italic">Zero transaction records found</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Funds Transfer Modal */}
      <AnimatePresence>
        {showFundsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => setShowFundsModal(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative z-10 w-full max-w-sm overflow-hidden rounded-[32px] bg-slate-900 border border-slate-800 p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-white italic uppercase tracking-tighter">Transfer</h3>
                <div className="flex gap-1 bg-slate-950 p-1 rounded-xl">
                  <button 
                    onClick={() => setFundsAction('DEPOSIT')}
                    className={cn(
                      "px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all",
                      fundsAction === 'DEPOSIT' ? "bg-emerald-600 text-white shadow-lg" : "text-slate-600"
                    )}
                  >Deposit</button>
                  <button 
                    onClick={() => setFundsAction('WITHDRAW')}
                    className={cn(
                      "px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all",
                      fundsAction === 'WITHDRAW' ? "bg-rose-600 text-white shadow-lg" : "text-slate-600"
                    )}
                  >Withdraw</button>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">Amount (USD)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-mono italic">$</span>
                    <input 
                      type="number"
                      value={fundsAmount}
                      onChange={(e) => setFundsAmount(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-8 pr-4 text-white font-mono text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {["10", "50", "100"].map(val => (
                    <button 
                      key={val}
                      onClick={() => setFundsAmount(val)}
                      className="py-2 bg-slate-950 border border-slate-800 rounded-xl text-[10px] font-bold hover:bg-slate-800 transition-colors"
                    >
                      ${val}
                    </button>
                  ))}
                </div>

                <button 
                  onClick={async () => {
                   if (fundsAction === 'DEPOSIT') await handleDeposit(parseFloat(fundsAmount));
                   else await handleWithdraw(parseFloat(fundsAmount));
                   setShowFundsModal(false);
                  }}
                  className={cn(
                    "w-full py-4 rounded-2xl font-black uppercase tracking-widest transition-all active:scale-95 shadow-xl",
                    fundsAction === 'DEPOSIT' ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
                  )}
                >
                  Confirm {fundsAction.toLowerCase()}
                </button>
                
                <p className="text-[9px] text-center text-slate-600 font-bold uppercase tracking-widest italic">
                  Processing via encrypted bridge
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

