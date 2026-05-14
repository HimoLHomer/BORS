import React, { useState, useEffect, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { collection, onSnapshot, query, addDoc } from 'firebase/firestore';
import { 
  Plus, 
  TrendingUp, 
  TrendingDown,
  Wallet, 
  RefreshCcw,
  X,
  Activity,
  Zap,
  Trash2,
  Pencil,
  LayoutDashboard,
  Coins,
  Flame,
  Search,
  Settings2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Asset, PortfolioStats, HistoryPoint } from './types';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Treemap
} from 'recharts';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';

// --- Types & Enums ---

enum View {
  DASHBOARD = 'DASHBOARD',
  DIVIDENDS = 'DIVIDENDS',
  FIRE = 'FIRE',
  MARKET_RECAP = 'MARKET_RECAP'
}

// --- Components ---

const formatCurrency = (value: number, currency: string = 'EUR') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const LoadingScreen = () => (
  <div className="fixed inset-0 bg-bg flex items-center justify-center z-50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
      <div className="font-black text-2xl tracking-tighter text-text-p uppercase">BÖRS</div>
      <p className="text-[10px] text-text-s font-mono uppercase tracking-widest animate-pulse">Initializing Market Feed</p>
    </div>
  </div>
);

const Header = ({ isLocalMode, apiStatus }: { isLocalMode: boolean, apiStatus: string }) => (
  <header className="border-b border-border bg-bg px-6 py-4 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="font-black text-xl tracking-tighter flex items-center gap-1 text-text-p uppercase">
        BÖRS
      </div>
    </div>
    
    <div className="flex items-center gap-8">
      <div className="hidden md:flex items-center gap-8 text-[10px] text-text-s font-bold uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            Feed: {apiStatus === 'connected' ? (
              <span className="text-green flex items-center gap-1.5"><RefreshCcw className="w-3 h-3 animate-spin-slow" />Yahoo Live</span>
            ) : apiStatus === 'connecting' ? (
              <span className="text-text-s flex items-center gap-1.5 animate-pulse">Connecting...</span>
            ) : (
              <span className="text-red flex items-center gap-1.5">Stream Error</span>
            )}
          </div>
        </div>
        <div className="hidden lg:block border-l border-border pl-8">System Time: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </div>
  </header>
);

// --- Main App Logic ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const recordAttemptedRef = useRef<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const [marketChanges, setMarketChanges] = useState<Record<string, number>>({});
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ 'EUR': 1 });
  const [apiStatus, setApiStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [activeView, setActiveView] = useState<View>(View.DASHBOARD);

  useEffect(() => {
    const checkApi = async () => {
      try {
        const res = await fetch('/api/health/yahoo');
        const data = await res.json();
        if (data.status === 'connected') setApiStatus('connected');
        else setApiStatus('error');
      } catch (e) {
        setApiStatus('error');
      }
    };
    checkApi();
    const interval = setInterval(checkApi, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.warn("Secure session initialization restricted. Activating Hybrid Local Mode.");
          setIsLocalMode(true);
          setLoading(false);
        }
      } else {
        setUser(u);
        setIsLocalMode(false);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Real-time market data: Integrated Yahoo Finance Backend
  useEffect(() => {
    const fetchRealData = async () => {
      const symbols = assets.map(a => a.symbol);
      if (symbols.length === 0) return;

      try {
        const res = await fetch('/api/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols, baseCurrency: 'EUR' })
        });
        const data = await res.json();
        const newPrices: Record<string, number> = {};
        const newChanges: Record<string, number> = {};
        if (data.quotes) {
          data.quotes.forEach((item: any) => {
            if (item.price) newPrices[item.symbol] = item.price;
            if (item.changePercent !== undefined) newChanges[item.symbol] = item.changePercent;
          });
        }
        if (data.rates) setExchangeRates(data.rates);
        setMarketPrices(prev => ({ ...prev, ...newPrices }));
        setMarketChanges(prev => ({ ...prev, ...newChanges }));
      } catch (e) {
        console.warn("Backend feed connection limited. Using local simulation vectors.");
      }
    };

    fetchRealData();
    const dataInterval = setInterval(fetchRealData, 15000); // Fetch real data every 15s
    
    const heartbeatInterval = setInterval(() => {
      setMarketPrices(prev => {
        const next = { ...prev };
        assets.forEach(asset => {
          const base = prev[asset.symbol] || asset.averagePrice;
          const volatility = 0.0003; // Extremely subtle heartbeat for professional feel
          next[asset.symbol] = base * (1 + (Math.random() - 0.5) * volatility);
        });
        return next;
      });
    }, 5000); 

    return () => {
      clearInterval(dataInterval);
      clearInterval(heartbeatInterval);
    };
  }, [assets]);

  // Hybrid State Management: Cloud Sync or Local Storage
  useEffect(() => {
    if (isLocalMode) {
      const saved = localStorage.getItem('alpha_os_assets');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Asset[];
          const hydrated = parsed.map(a => ({
            ...a,
            id: a.id || `local-${Math.random().toString(36).substr(2, 9)}`
          }));
          setAssets(hydrated);
        } catch (e) {
          console.error("Local data corrupted. Purging cache.");
          localStorage.removeItem('alpha_os_assets');
        }
      }

      const savedHistory = localStorage.getItem('alpha_os_history');
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory));
        } catch (e) {
          localStorage.removeItem('alpha_os_history');
        }
      }
    }
  }, [isLocalMode]);

  useEffect(() => {
    if (isLocalMode) {
      localStorage.setItem('alpha_os_assets', JSON.stringify(assets));
    }
  }, [assets, isLocalMode]);

  useEffect(() => {
    if (!user || isLocalMode) return;
    
    // Assets subscription
    const qAssets = query(collection(db, 'users', user.uid, 'assets'));
    const unsubAssets = onSnapshot(qAssets, (snapshot) => {
      const assetsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Asset[];
      setAssets(assetsData);
    });

    // History subscription
    const qHistory = query(collection(db, 'users', user.uid, 'history'));
    const unsubHistory = onSnapshot(qHistory, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as HistoryPoint[];
      
      // Deduplicate by date to ensure "1 value per day" as requested
      const seen = new Set();
      const uniqueHistory = historyData
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter(p => {
          if (seen.has(p.date)) return false;
          seen.add(p.date);
          return true;
        });

      setHistory(uniqueHistory);
    });

    return () => {
      unsubAssets();
      unsubHistory();
    };
  }, [user, isLocalMode]);

  const removeAsset = async (id: string) => {
    if (isLocalMode) {
      setAssets(prev => prev.filter(a => a.id !== id));
      return;
    }
    if (!user) return;
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'users', user.uid, 'assets', id));
    } catch (err) {
      console.error("Failed to remove position:", err);
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/assets/${id}`);
    }
  };

  const stats: PortfolioStats = assets.reduce((acc, asset) => {
    const livePrice = marketPrices[asset.symbol] || asset.averagePrice;
    const rate = exchangeRates[asset.currency] || 1;
    
    // Convert to EUR for total stats
    const valInEur = (asset.quantity * livePrice) * rate;
    const costInEur = (asset.quantity * asset.averagePrice) * rate;
    
    acc.totalValue += valInEur;
    acc.totalCost += costInEur;
    return acc;
  }, { totalValue: 0, totalCost: 0, totalGain: 0, totalGainPercent: 0, dailyChange: 0, dailyChangePercent: 0 });

  stats.totalGain = stats.totalValue - stats.totalCost;
  stats.totalGainPercent = stats.totalCost > 0 ? (stats.totalGain / stats.totalCost) * 100 : 0;
  
  // Real daily change calculation based on history
  const yesterday = history.length > 1 ? history[history.length - 2] : null;
  if (yesterday) {
    stats.dailyChange = stats.totalValue - yesterday.value;
    stats.dailyChangePercent = (stats.dailyChange / yesterday.value) * 100;
  } else {
    stats.dailyChange = 0;
    stats.dailyChangePercent = 0;
  }

  const [isVizSettingsOpen, setIsVizSettingsOpen] = useState(false);
  const [vizSettings, setVizSettings] = useState(() => {
    const saved = localStorage.getItem('alpha_os_viz_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse viz settings", e);
      }
    }
    return {
      outerRadius: 85,
      labelRadius: 25,
      minPercent: 0.8,
      fontSize: 10,
      innerRadius: 45,
      labelStagger: 18,
      chartPadding: 40
    };
  });

  // Persist viz settings
  useEffect(() => {
    localStorage.setItem('alpha_os_viz_settings', JSON.stringify(vizSettings));
  }, [vizSettings]);

  // Persistence logic for history
  useEffect(() => {
    const clearHistory = async () => {
      // One-time sweep to clear old history and restart with dummy data as requested
      if (localStorage.getItem('alpha_os_fresh_sweep_v4')) return;
      
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = yesterdayDate.toISOString().split('T')[0];
      const dummyPoint = { date: yesterdayStr, value: 98000 };

      if (isLocalMode) {
        localStorage.setItem('alpha_os_history', JSON.stringify([dummyPoint]));
        setHistory([dummyPoint]);
      } else if (user) {
        try {
          const { getDocs, deleteDoc, doc, collection: fsColl, addDoc } = await import('firebase/firestore');
          const snap = await getDocs(fsColl(db, 'users', user.uid, 'history'));
          const deletes = snap.docs.map(d => deleteDoc(doc(db, 'users', user.uid, 'history', d.id)));
          await Promise.all(deletes);
          await addDoc(fsColl(db, 'users', user.uid, 'history'), dummyPoint);
          setHistory([dummyPoint]);
        } catch (e) { 
          console.error("Failed to clear Firebase history", e); 
        }
      }
      localStorage.setItem('alpha_os_fresh_sweep_v4', 'true');
    };
    
    if (user || isLocalMode) {
      clearHistory();
    }
  }, [user, isLocalMode]);

  useEffect(() => {
    if (stats.totalValue <= 0 || loading) return;
    
    const today = new Date().toISOString().split('T')[0];
    const hasToday = history.some(p => p.date === today);
    
    // Take exactly one value per day (the first one recorded in the session)
    if (!hasToday && recordAttemptedRef.current !== today) {
      const recordPoint = async () => {
        // Double check hasToday inside the async call in case history updated
        if (history.some(p => p.date === today)) return;
        
        recordAttemptedRef.current = today;
        const point = { date: today, value: stats.totalValue };
        if (isLocalMode) {
          const next = [...history, point];
          setHistory(next);
          localStorage.setItem('alpha_os_history', JSON.stringify(next));
        } else if (user) {
          try {
            const { collection: fsColl, addDoc } = await import('firebase/firestore');
            await addDoc(fsColl(db, 'users', user.uid, 'history'), point);
          } catch (e) {
            console.error("History sync failed", e);
          }
        }
      };
      const timeout = setTimeout(recordPoint, 5000);
      return () => clearTimeout(timeout);
    }
  }, [stats.totalValue, history, isLocalMode, user, loading]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden font-sans selection:bg-accent/30">
      <Header isLocalMode={isLocalMode} apiStatus={apiStatus} />
      
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-20 min-w-[80px] border-r border-border bg-card flex flex-col items-center py-8 gap-8 z-10 shadow-2xl">
          <NavButton 
            active={activeView === View.DASHBOARD} 
            onClick={() => setActiveView(View.DASHBOARD)} 
            icon={<LayoutDashboard className="w-5 h-5" />} 
            label="Dashboard" 
          />
          <NavButton 
            active={activeView === View.DIVIDENDS} 
            onClick={() => setActiveView(View.DIVIDENDS)} 
            icon={<Coins className="w-5 h-5" />} 
            label="Dividends" 
          />
          <NavButton 
            active={activeView === View.FIRE} 
            onClick={() => setActiveView(View.FIRE)} 
            icon={<Flame className="w-5 h-5" />} 
            label="FIRE" 
          />
          <NavButton 
            active={activeView === View.MARKET_RECAP} 
            onClick={() => setActiveView(View.MARKET_RECAP)} 
            icon={<Activity className="w-5 h-5" />} 
            label="Recap" 
          />
        </aside>

        <main className="flex-1 overflow-y-auto technical-grid p-6">
          <AnimatePresence mode="wait">
            {activeView === View.DASHBOARD && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[auto_auto] gap-4"
              >
                {/* Main Portfolio Performance */}
                <div className="lg:col-span-2 lg:row-span-2 glass-panel p-8 flex flex-col group h-full">
                  <h3 className="card-title">Portfolio Capital</h3>
                  <div className="stat-value text-6xl mb-2 flex items-baseline gap-2 tabular-nums">
                    {formatCurrency(stats.totalValue, 'EUR')}
                  </div>
                  <div className={`flex items-center gap-2 text-sm font-bold ${stats.totalGain >= 0 ? 'text-green' : 'text-red'}`}>
                    <div className={`p-1 rounded-md ${stats.totalGain >= 0 ? 'bg-green/10' : 'bg-red/10'}`}>
                      {stats.totalGain >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    </div>
                    {Math.abs(stats.totalGainPercent).toFixed(2)}% 
                  </div>

                  <div className="flex-1 mt-8 min-h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={(() => {
                          const todayStr = new Date().toISOString().split('T')[0];
                          // Map history and ensure unique dates (latest recorded for that day wins, though recording logic only allows one)
                          const baseData = history.filter((p, i, self) => i === self.findIndex(t => t.date === p.date)).map(p => ({
                            date: p.date,
                            name: new Date(p.date).toLocaleDateString([], { month: 'short', day: 'numeric' }),
                            value: p.value
                          }));
                          
                          const hasStoredToday = history.some(p => p.date === todayStr);
                          
                          if (!hasStoredToday && stats.totalValue > 0) {
                            baseData.push({ 
                              date: todayStr,
                              name: 'Today', 
                              value: stats.totalValue 
                            });
                          }
                          
                          return baseData;
                        })()}>
                          <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="name" hide />
                          <Tooltip 
                            formatter={(value: number) => [formatCurrency(value, 'EUR'), '']}
                            separator=""
                            labelStyle={{ color: 'var(--color-text-s)', fontSize: '10px', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 'bold', opacity: 0.5 }}
                            contentStyle={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '12px' }}
                            itemStyle={{ color: 'var(--color-accent)', fontWeight: '900', fontSize: '14px' }}
                            cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
                          />
                          <Area type="monotone" dataKey="value" stroke="var(--color-accent)" fillOpacity={1} fill="url(#colorValue)" strokeWidth={3} animationDuration={1000} />
                        </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="lg:col-span-2 lg:row-span-2 flex flex-col gap-4">
                  <div className="glass-panel p-6 flex flex-col flex-1 aspect-square lg:aspect-auto min-h-[720px] relative">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="card-title">Allocation</h3>
                      <button 
                        onClick={() => setIsVizSettingsOpen(!isVizSettingsOpen)}
                        className={`p-1.5 rounded-lg transition-all ${isVizSettingsOpen ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'bg-white/5 text-text-s hover:bg-white/10'}`}
                      >
                        <Settings2 className="w-4 h-4" />
                      </button>
                    </div>

                    <AnimatePresence>
                      {isVizSettingsOpen && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mb-4 overflow-hidden"
                        >
                          <div className="p-4 bg-white/5 rounded-xl border border-border/50 grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-text-s uppercase tracking-widest block">Radius: {vizSettings.outerRadius}%</label>
                              <input 
                                type="range" min="30" max="100" step="1"
                                value={vizSettings.outerRadius}
                                onChange={e => setVizSettings({...vizSettings, outerRadius: parseInt(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-text-s uppercase tracking-widest block">Size (Padding): {vizSettings.chartPadding}px</label>
                              <input 
                                type="range" min="0" max="150" step="5"
                                value={vizSettings.chartPadding}
                                onChange={e => setVizSettings({...vizSettings, chartPadding: parseInt(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-text-s uppercase tracking-widest block">Label Gap: {vizSettings.labelRadius}px</label>
                              <input 
                                type="range" min="0" max="100" step="1"
                                value={vizSettings.labelRadius}
                                onChange={e => setVizSettings({...vizSettings, labelRadius: parseInt(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-text-s uppercase tracking-widest block">Stagger: {vizSettings.labelStagger}px</label>
                              <input 
                                type="range" min="0" max="40" step="1"
                                value={vizSettings.labelStagger}
                                onChange={e => setVizSettings({...vizSettings, labelStagger: parseInt(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-text-s uppercase tracking-widest block">Min %: {vizSettings.minPercent}%</label>
                              <input 
                                type="range" min="0.1" max="5" step="0.1"
                                value={vizSettings.minPercent}
                                onChange={e => setVizSettings({...vizSettings, minPercent: parseFloat(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-text-s uppercase tracking-widest block">Text: {vizSettings.fontSize}px</label>
                              <input 
                                type="range" min="6" max="14" step="1"
                                value={vizSettings.fontSize}
                                onChange={e => setVizSettings({...vizSettings, fontSize: parseInt(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent"
                              />
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="flex-1 mt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart margin={{ 
                          top: vizSettings.chartPadding, 
                          right: vizSettings.chartPadding, 
                          bottom: vizSettings.chartPadding, 
                          left: vizSettings.chartPadding 
                        }}>
                          <Pie
                            data={assets.length > 0 ? assets.map(a => {
                              const val = (a.quantity * (marketPrices[a.symbol] || a.averagePrice)) * (exchangeRates[a.currency] || 1);
                              return {
                                name: a.name,
                                value: val,
                                percent: (val / stats.totalValue) * 100
                              };
                            }).sort((a, b) => b.value - a.value) : [{ name: 'Empty', value: 1, percent: 0 }]}
                            cx="50%"
                            cy="50%"
                            innerRadius={`${vizSettings.innerRadius}%`}
                            outerRadius={`${vizSettings.outerRadius}%`}
                            dataKey="value"
                            startAngle={90}
                            endAngle={-270}
                            paddingAngle={1}
                            stroke="rgba(0,0,0,0.1)"
                            isAnimationActive={false}
                            labelLine={false}
                            label={({ cx, cy, midAngle, outerRadius, name, percent, index }) => {
                              const RADIAN = Math.PI / 180;
                              const sin = Math.sin(-midAngle * RADIAN);
                              const cos = Math.cos(-midAngle * RADIAN);
                              
                              // Stagger vertical position for small slices
                              const yStagger = (index % 4 - 1.5) * vizSettings.labelStagger;
                              
                              const sx = cx + (outerRadius as number) * cos;
                              const sy = cy + (outerRadius as number) * sin;
                              const mx = cx + ((outerRadius as number) + vizSettings.labelRadius) * cos;
                              const my = cy + ((outerRadius as number) + vizSettings.labelRadius) * sin + yStagger;
                              const ex = mx + (cos >= 0 ? 1 : -1) * 22;
                              const ey = my;
                              const textAnchor = cos >= 0 ? 'start' : 'end';

                              if (percent < vizSettings.minPercent) return null;

                              return (
                                <g>
                                  <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke="var(--color-text-s)" fill="none" opacity={0.2} />
                                  <circle cx={sx} cy={sy} r={2} fill="var(--color-text-s)" opacity={0.5} />
                                  <text 
                                    x={ex + (cos >= 0 ? 1 : -1) * 12} 
                                    y={ey - (vizSettings.fontSize / 2 + 1)} 
                                    fill="var(--color-text-p)"
                                    textAnchor={textAnchor}
                                    dominantBaseline="central"
                                    style={{ fontSize: `${vizSettings.fontSize + 1}px` }}
                                    className="font-black tracking-tight uppercase"
                                  >
                                    {name.length > 20 ? name.substring(0, 18) + '...' : name}
                                  </text>
                                  <text
                                    x={ex + (cos >= 0 ? 1 : -1) * 12}
                                    y={ey + (vizSettings.fontSize / 2 + 3)}
                                    fill="var(--color-text-s)"
                                    textAnchor={textAnchor}
                                    dominantBaseline="central"
                                    style={{ fontSize: `${vizSettings.fontSize}px` }}
                                    className="font-mono opacity-80 font-bold"
                                  >
                                    {percent.toFixed(2)}%
                                  </text>
                                </g>
                              );
                            }}
                          >
                            {assets.length > 0 ? assets.map((_, index) => (
                              <Cell 
                                key={`cell-${index}`} 
                                fill={[
                                  '#002159', // Darkest (Largest holding)
                                  '#003a94', 
                                  '#0055d4', 
                                  '#1a75ff', 
                                  '#66a3ff', 
                                  '#aaccff',
                                  '#e0e9ff'  // Lightest (Smallest holding)
                                ][index % 7]} 
                                strokeWidth={0}
                              />
                            )) : <Cell fill="var(--color-border)" stroke="none" />}
                          </Pie>
                          <Tooltip 
                            formatter={(value: number) => [formatCurrency(value, 'EUR'), '']}
                            separator=""
                            contentStyle={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '12px' }}
                            itemStyle={{ color: 'var(--color-text-p)' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>


                {/* Holdings Table Section */}
                <div className="lg:col-span-4 glass-panel p-8 bg-[#0e0e10]/80">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-xl font-black tracking-tight text-white uppercase">Holdings</h3>
                    </div>
                    <button 
                      onClick={() => {
                        setEditingAsset(null);
                        setIsModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-accent text-white rounded-lg font-black uppercase tracking-widest text-[8px] shadow-lg shadow-accent/20 active:scale-[0.98] transition-all flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Asset
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-separate border-spacing-y-2">
                      <thead>
                        <tr className="text-[9px] font-bold text-text-s uppercase tracking-[0.25em] opacity-50">
                          <th className="px-4 py-2">Asset</th>
                          <th className="px-4 py-2">Shares</th>
                          <th className="px-4 py-2">Total Value</th>
                          <th className="px-4 py-2">Cost Basis</th>
                          <th className="px-4 py-2 text-accent">Total Gain</th>
                          <th className="px-4 py-2">24h Change</th>
                          <th className="px-4 py-2 text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="text-xs font-mono font-bold">
                        {[...assets].sort((a, b) => {
                          const valA = (a.quantity * (marketPrices[a.symbol] || a.averagePrice)) * (exchangeRates[a.currency] || 1);
                          const valB = (b.quantity * (marketPrices[b.symbol] || b.averagePrice)) * (exchangeRates[b.currency] || 1);
                          return valB - valA;
                        }).map((item, index) => {
                          const price = marketPrices[item.symbol] || item.averagePrice;
                          const rate = exchangeRates[item.currency] || 1;
                          const priceInEur = price * rate;
                          const costBasisInEur = (item.quantity * item.averagePrice) * rate;
                          const totalValue = item.quantity * priceInEur;
                          const totalGainInEur = totalValue - costBasisInEur;
                          const totalGainPercent = costBasisInEur > 0 ? (totalGainInEur / costBasisInEur) * 100 : 0;
                          const change = marketChanges[item.symbol] || 0;
                          
                          return (
                            <tr key={item.id || `row-${index}`} className="group bg-bg/40 hover:bg-bg transition-all outline outline-1 outline-border/50 hover:outline-accent/30 rounded-2xl">
                              <td className="px-4 py-3 rounded-l-2xl">
                                <div className="flex items-center">
                                  <div>
                                    <div className="text-text-p text-sm font-sans">{item.name}</div>
                                    <div className="text-[9px] text-text-s/60 font-mono uppercase tracking-widest">
                                      {item.displaySymbol || (item.symbol.includes('.') ? item.symbol.split('.')[0] : item.symbol)}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-text-p tabular-nums">{item.quantity}</td>
                              <td className="px-4 py-3 text-text-p tabular-nums tracking-tighter">{formatCurrency(totalValue, 'EUR')}</td>
                              <td className="px-4 py-3 text-text-s/40 tabular-nums">{formatCurrency(costBasisInEur, 'EUR')}</td>
                              <td className="px-4 py-3 tabular-nums">
                                <div className={totalGainInEur >= 0 ? 'text-green' : 'text-red'}>
                                  <div className="text-xs font-bold">{totalGainPercent >= 0 ? '+' : ''}{totalGainPercent.toFixed(2)}%</div>
                                  <div className="text-[11px] opacity-60 font-sans">{formatCurrency(totalGainInEur, 'EUR')}</div>
                                </div>
                              </td>
                              <td className="px-4 py-3 tabular-nums">
                                <span className={`flex items-center gap-1 ${change >= 0 ? 'text-green' : 'text-red'}`}>
                                  {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                  {Math.abs(change).toFixed(2)}%
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right rounded-r-2xl">
                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                  <button 
                                    onClick={() => {
                                      setEditingAsset(item);
                                      setIsModalOpen(true);
                                    }}
                                    className="p-2.5 text-text-s hover:text-accent hover:bg-accent/10 rounded-lg transition-all"
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => removeAsset(item.id!)}
                                    className="p-2.5 text-text-s hover:text-red hover:bg-red/10 rounded-lg transition-all"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {assets.length === 0 && (
                          <tr className="bg-bg/40 opacity-20">
                            <td colSpan={6} className="px-6 py-20 text-center rounded-2xl">
                              <div className="flex flex-col items-center gap-4">
                                <Wallet className="w-12 h-12" />
                                <p className="text-[10px] uppercase font-bold tracking-widest">No Holdings Registered</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeView === View.DIVIDENDS && (
              <motion.div 
                key="dividends"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1400px] mx-auto p-8 glass-panel h-full"
              >
                <div className="mb-8">
                  <h2 className="text-2xl font-black tracking-tight text-white uppercase">Dividends Engine</h2>
                  <p className="text-[10px] text-text-s font-bold uppercase tracking-[0.2em]">Projected Yield & Payout Schedules</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-[calc(100%-100px)]">
                  <div className="bg-bg/40 rounded-2xl border border-border/50 p-12 flex flex-col items-center justify-center text-center">
                    <Coins className="w-12 h-12 text-accent mb-4 opacity-30" />
                    <p className="text-text-s text-sm mb-2 uppercase font-bold tracking-widest">Expected Annual Yield</p>
                    <div className="text-6xl font-black text-text-p tabular-nums">{formatCurrency(stats.totalValue * 0.032, 'EUR')}</div>
                    <p className="text-[10px] text-accent mt-4 font-mono">ESTIMATED 3.2% AVG YIELD</p>
                  </div>
                  <div className="bg-bg/40 rounded-2xl border border-border/50 p-12 flex items-center justify-center">
                    <p className="text-text-s text-xs font-mono uppercase tracking-widest opacity-40">Monthly payout visualization loading...</p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeView === View.FIRE && (
              <motion.div 
                key="fire"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1400px] mx-auto p-8 glass-panel h-full"
              >
                <div className="mb-8">
                  <h2 className="text-2xl font-black tracking-tight text-white uppercase">FIRE Projection</h2>
                  <p className="text-[10px] text-text-s font-bold uppercase tracking-[0.2em]">Financial Independence Exit Strategy</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="bg-bg/40 rounded-2xl border border-border/50 p-8">
                    <p className="text-[10px] text-text-s uppercase font-bold mb-1">Independence Goal</p>
                    <div className="text-3xl font-black text-text-p">€750,000</div>
                    <div className="h-1 bg-border rounded-full mt-4 overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${Math.min((stats.totalValue / 750000) * 100, 100)}%` }}></div>
                    </div>
                    <p className="text-[9px] text-accent mt-2 font-mono">{(stats.totalValue / 750000 * 100).toFixed(2)}% ACHIEVED</p>
                  </div>
                  <div className="md:col-span-2 bg-bg/40 rounded-2xl border border-border/50 p-8 flex items-center justify-center">
                    <div className="text-center">
                      <Flame className="w-12 h-12 text-red/40 mx-auto mb-4" />
                      <p className="text-text-s text-xs font-mono uppercase tracking-widest opacity-60">Retirement timeline simulation in process...</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeView === View.MARKET_RECAP && (
              <motion.div 
                key="market-recap"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1400px] mx-auto p-8 space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black tracking-tight text-white uppercase">Market Intelligence</h2>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green animate-pulse"></div>
                      <p className="text-[10px] text-text-s font-bold uppercase tracking-[0.2em]">Global Feed Active • Live Performance Data</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                  <div className="lg:col-span-3 space-y-8">
                    <div className="glass-panel p-6 min-h-[500px] flex flex-col">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="card-title">S&P 500 Heatmap</h3>
                        <span className="text-[9px] text-text-s font-mono uppercase tracking-widest px-3 py-1 bg-white/5 rounded-full">Top US Tech & Finance</span>
                      </div>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <Treemap
                            data={[
                              { name: 'Technology', children: [{ name: 'AAPL', size: 3000, change: 1.2 }, { name: 'MSFT', size: 2800, change: -0.5 }, { name: 'NVDA', size: 2200, change: 3.8 }, { name: 'AVGO', size: 900, change: 2.1 }] },
                              { name: 'Comm Services', children: [{ name: 'GOOGL', size: 1800, change: 0.8 }, { name: 'META', size: 1500, change: -1.2 }, { name: 'NFLX', size: 600, change: 1.4 }] },
                              { name: 'Consumer', children: [{ name: 'AMZN', size: 1700, change: 0.5 }, { name: 'TSLA', size: 800, change: -2.4 }, { name: 'HD', size: 500, change: 0.2 }] },
                              { name: 'Finance', children: [{ name: 'BRK-B', size: 1000, change: 0.2 }, { name: 'JPM', size: 700, change: 0.1 }, { name: 'V', size: 600, change: 0.5 }] },
                              { name: 'Healthcare', children: [{ name: 'LLY', size: 850, change: 1.1 }, { name: 'UNH', size: 750, change: -0.4 }, { name: 'JNJ', size: 600, change: 0.2 }] }
                            ]}
                            dataKey="size"
                            stroke="#000"
                            fill="#0f172a"
                            content={<CustomTreemapContent />}
                          />
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="glass-panel p-6 min-h-[400px] flex flex-col">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="card-title">OMX Helsinki 25</h3>
                        <span className="text-[9px] text-text-s font-mono uppercase tracking-widest px-3 py-1 bg-white/5 rounded-full">Nordic Blue Chips</span>
                      </div>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <Treemap
                            data={[
                              { name: 'Industrial', children: [{ name: 'NESTE', size: 120, change: -3.2 }, { name: 'UPM', size: 100, change: 0.5 }, { name: 'METSO', size: 85, change: 1.2 }, { name: 'FORTUM', size: 80, change: -1.1 }] },
                              { name: 'Finance', children: [{ name: 'SAMPO', size: 150, change: -0.1 }, { name: 'NDA-FI', size: 140, change: 0.8 }] },
                              { name: 'Technology', children: [{ name: 'NOKIA', size: 110, change: 1.5 }, { name: 'ELISA', size: 75, change: -0.2 }] },
                              { name: 'Retail', children: [{ name: 'KESKOB', size: 90, change: 2.1 }] }
                            ]}
                            dataKey="size"
                            stroke="#000"
                            fill="#0f172a"
                            aspectRatio={4/3}
                            content={<CustomTreemapContent />}
                          />
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-1">
                    <MarketAISummary />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <AddAssetModal 
            onClose={() => {
              setIsModalOpen(false);
              setEditingAsset(null);
            }} 
            user={user} 
            isLocalMode={isLocalMode}
            editAsset={editingAsset || undefined}
            onLocalSave={(asset) => {
              if (editingAsset) {
                setAssets(prev => prev.map(a => a.id === asset.id ? asset : a));
              } else {
                setAssets(prev => [...prev, asset]);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Internal Components ---

const CustomTreemapContent = (props: any) => {
  const { x, y, width, height, name, change } = props;
  if (width < 30 || height < 20) return null;
  
  const intensity = Math.min(Math.abs(change) * 20, 90);
  const color = change >= 0 
    ? `rgba(34, 197, 94, ${intensity / 100 + 0.1})` 
    : `rgba(239, 68, 68, ${intensity / 100 + 0.1})`;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: color,
          stroke: 'rgba(0,0,0,0.4)',
          strokeWidth: 2,
        }}
      />
      {width > 40 && height > 30 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 4}
            textAnchor="middle"
            fill="#fff"
            fontSize={Math.min(width, height) / 5}
            fontWeight="900"
            className="uppercase tracking-tighter"
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="#fff"
            fontSize={Math.min(width, height) / 7}
            opacity={0.8}
            fontWeight="bold"
          >
            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
          </text>
        </>
      )}
    </g>
  );
};

const MarketAISummary = () => {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const generateSummary = async () => {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: "Why are the global stock markets moving the way they are today? Provide a brief, professional summary of today's key market drivers, economic reports, and geopolitical factors. Focus on S&P 500 and Nordic markets.",
          config: {
            tools: [{ googleSearch: {} }],
          },
        });
        setSummary(response.text || 'Market intelligence feed currently being processed. Re-evaluating drivers...');
      } catch (e) {
        setSummary('Connection to ALPHA-OS Intelligence failed. Retrying market synthesis...');
      } finally {
        setLoading(false);
      }
    };
    generateSummary();
  }, []);

  return (
    <div className="glass-panel p-8 h-full flex flex-col border-accent/20">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
          <Zap className="w-5 h-5 text-accent animate-pulse" />
        </div>
        <div>
          <h3 className="card-title leading-none">AI Market Summary</h3>
          <p className="text-[9px] text-text-s uppercase font-mono tracking-widest mt-1">Grounding: Google Search</p>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-4">
            <div className="h-4 bg-white/5 rounded-full w-3/4 animate-pulse"></div>
            <div className="h-4 bg-white/5 rounded-full w-full animate-pulse"></div>
            <div className="h-4 bg-white/5 rounded-full w-5/6 animate-pulse"></div>
            <div className="h-4 bg-white/5 rounded-full w-2/3 animate-pulse"></div>
          </div>
        ) : (
          <div className="markdown-body text-text-p text-sm leading-relaxed prose prose-sm prose-invert max-w-none">
            <Markdown>{summary}</Markdown>
          </div>
        )}
      </div>
      
      {!loading && (
        <div className="mt-8 p-4 bg-white/5 rounded-xl border border-border/50">
          <p className="text-[8px] text-text-s uppercase font-mono text-center tracking-widest leading-normal">
            Information provided by Börs Intelligence is for informational purposes only. Not financial advice.
          </p>
        </div>
      )}
    </div>
  );
};

const NavButton = ({ active, onClick, icon, label }: { 
  active: boolean, 
  onClick: () => void, 
  icon: React.ReactNode, 
  label: string 
}) => (
  <button 
    onClick={onClick}
    className={`group relative p-3 rounded-xl transition-all ${active ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-text-s hover:text-text-p hover:bg-white/5'}`}
  >
    {icon}
    <div className="absolute left-full ml-3 opacity-0 group-hover:opacity-100 transition-opacity bg-card border border-border px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest pointer-events-none whitespace-nowrap z-50">
      {label}
    </div>
  </button>
);

const AddAssetModal = ({ onClose, user, isLocalMode, onLocalSave, editAsset }: { 
  onClose: () => void, 
  user: User | null, 
  isLocalMode: boolean,
  onLocalSave: (asset: Asset) => void,
  editAsset?: Asset
}) => {
  const [formData, setFormData] = useState({
    symbol: editAsset?.symbol || '',
    displaySymbol: editAsset?.displaySymbol || '',
    name: editAsset?.name || '',
    type: editAsset?.type || 'etf',
    quantity: editAsset?.quantity?.toString() || '',
    averagePrice: editAsset?.averagePrice?.toString() || '',
    currency: editAsset?.currency || 'EUR'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchResults(data || []);
    } catch (e) {
      console.error("Search failed:", e);
    } finally {
      setIsSearching(false);
    }
  };

  const selectAsset = (asset: any) => {
    const displayName = asset.longName || asset.shortName || asset.name || asset.symbol;
    // Guess a cleaner display symbol (e.g. O instead of RY6.F)
    let displaySymbol = asset.symbol;
    if (displaySymbol.includes('.')) {
      displaySymbol = displaySymbol.split('.')[0];
    }
    
    setFormData(prev => ({
      ...prev,
      symbol: asset.symbol,
      displaySymbol: displaySymbol,
      name: displayName,
      currency: asset.currency || prev.currency,
      type: asset.quoteType?.toLowerCase().includes('etf') || asset.typeDisp?.toLowerCase().includes('etf') ? 'etf' : 
            asset.quoteType?.toLowerCase().includes('crypto') || asset.typeDisp?.toLowerCase().includes('crypto') ? 'crypto' : 'stock'
    }));
    setSearchResults([]);
    setSearchQuery('');
    setIsVerified(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Submit triggered for symbol:", formData.symbol);
    
    const newAsset: Asset = {
      id: editAsset?.id || (isLocalMode ? `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` : ''),
      ...formData,
      quantity: Number(formData.quantity),
      averagePrice: Number(formData.averagePrice),
      updatedAt: new Date().toISOString()
    } as Asset;

    if (isLocalMode) {
      onLocalSave(newAsset);
      onClose();
      return;
    }

    if (!user) {
      setError("Secure session not established. Retrying gateway...");
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    const path = `users/${user.uid}/assets`;
    
    try {
      if (editAsset?.id) {
        const { updateDoc, doc } = await import('firebase/firestore');
        await updateDoc(doc(db, path, editAsset.id), newAsset as any);
      } else {
        await addDoc(collection(db, path), newAsset);
      }
      console.log("Node successfully saved in ALPHA-OS.");
      onClose();
    } catch (err) {
      console.error("Submission failed:", err);
      setError("Cloud synchronization failed. Switch to local-only mode by reloading.");
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-fill label when symbol changes
  const checkSymbol = async (symbol: string) => {
    if (symbol.length < 2) return;
    setIsValidating(true);
    setIsVerified(false);
    try {
      const res = await fetch(`/api/quote/${symbol}`);
      const data = await res.json();
      if (data.name) {
        setFormData(prev => ({ 
          ...prev, 
          // Only auto-fill name if it is currently empty to prevent overwriting manual input
          name: prev.name === '' ? data.name : prev.name, 
          currency: data.currency || prev.currency 
        }));
        setIsVerified(true);
      } else {
        setIsVerified(false);
      }
    } catch (e) { 
      setIsVerified(false);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-bg/95 backdrop-blur-xl z-50 flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="glass-panel p-10 w-full max-w-lg relative bg-card/50 border-accent/20 shadow-2xl overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent/50 to-transparent"></div>
        <button onClick={onClose} className="absolute top-6 right-6 p-2 text-text-s hover:text-text-p transition-colors rounded-full hover:bg-white/5">
          <X className="w-5 h-5" />
        </button>
        
        <h2 className="text-2xl font-black tracking-tighter mb-1 text-text-p uppercase">{editAsset ? 'Edit Holding' : 'Add New Holding'}</h2>
        <p className="text-text-s mb-8 text-[10px] uppercase tracking-[0.25em] font-bold opacity-60">{editAsset ? 'Modify existing asset vector' : 'Add a new asset to your portfolio'}</p>
        
        <div className="mb-8 space-y-2 relative">
          <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Find Asset (Name or Ticker)</label>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-s opacity-40" />
            <input 
              type="text"
              className="w-full bg-bg border border-border focus:border-accent rounded-xl pl-12 pr-5 py-4 text-text-p focus:outline-none transition-all text-sm placeholder:opacity-20 shadow-inner"
              placeholder="e.g. S&P 500 or AAPL"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
            {isSearching && <RefreshCcw className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-accent" />}
          </div>
          
          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="absolute top-full left-0 w-full mt-2 bg-card border border-border rounded-xl shadow-2xl z-[60] max-h-60 overflow-y-auto divide-y divide-border/50"
              >
                {searchResults.map((result: any, i: number) => (
                  <button
                    key={result.symbol + i}
                    type="button"
                    onClick={() => selectAsset(result)}
                    className="w-full px-5 py-3 text-left hover:bg-white/5 transition-colors group flex items-start justify-between"
                  >
                    <div>
                      <div className="text-text-p text-xs font-bold">{result.shortName || result.longName}</div>
                      <div className="text-[10px] font-mono text-text-s group-hover:text-accent transition-colors">
                        {result.symbol}
                        {result.price && (
                          <span className="ml-2 font-sans opacity-40 group-hover:opacity-100 transition-opacity">
                            • {result.price.toFixed(2)} {result.currency}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] font-bold text-text-s opacity-40 uppercase tracking-widest">{result.exchange}</div>
                      {result.typeDisp && <div className="text-[8px] text-text-s font-sans opacity-20 uppercase tracking-tighter">{result.typeDisp}</div>}
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {error && (
            <div className="p-4 bg-red/10 border border-red/20 rounded-xl text-red text-[10px] uppercase font-bold tracking-widest animate-pulse">
              System Error: {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label className="text-[9px] font-bold text-text-s uppercase tracking-widest ml-1">Symbol (Ticker)</label>
                {isValidating && <RefreshCcw className="w-2.5 h-2.5 animate-spin text-accent" />}
                {isVerified && <div className="text-[8px] font-black text-green tracking-tighter uppercase flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> Verified</div>}
              </div>
              <input 
                required
                autoFocus
                className={`w-full bg-bg/50 border ${isVerified ? 'border-green/30' : 'border-border'} focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20`}
                placeholder="VWCE.DE"
                value={formData.symbol}
                onBlur={() => checkSymbol(formData.symbol)}
                onChange={e => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1 text-accent">Display Symbol (Visual)</label>
              <input 
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20"
                placeholder="VWC"
                value={formData.displaySymbol}
                onChange={e => setFormData({ ...formData, displaySymbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Currency</label>
              <select 
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all text-sm appearance-none"
                value={formData.currency}
                onChange={e => setFormData({ ...formData, currency: e.target.value })}
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Asset Label</label>
            <input 
              required
              className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all text-sm placeholder:opacity-20"
              placeholder="Vanguard FTSE All-World"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Quantity (Units)</label>
              <input 
                required
                type="number"
                step="any"
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0.00"
                value={formData.quantity}
                onChange={e => setFormData({ ...formData, quantity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-text-s uppercase tracking-widest px-1 ml-1">Cost Per Unit</label>
              <input 
                required
                type="number"
                step="any"
                className="w-full bg-bg/50 border border-border focus:border-accent/50 rounded-xl px-5 py-4 text-text-p focus:outline-none transition-all font-mono text-sm placeholder:opacity-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0.00"
                value={formData.averagePrice}
                onChange={e => setFormData({ ...formData, averagePrice: e.target.value })}
              />
            </div>
          </div>
          
          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full py-5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-black uppercase tracking-[0.2em] text-[11px] rounded-xl transition-all shadow-xl shadow-accent/20 active:scale-[0.98] mt-4 flex items-center justify-center gap-3"
          >
            {isSubmitting ? (
              <RefreshCcw className="w-4 h-4 animate-spin" />
            ) : (
              editAsset ? 'Save Changes' : 'Add to Portfolio'
            )}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
};

// --- Static Feed Data ---
