export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
}

export interface Asset {
  id?: string;
  symbol: string;
  displaySymbol?: string;
  name: string;
  type: 'stock' | 'crypto' | 'etf' | 'other';
  quantity: number;
  averagePrice: number;
  currency: string;
  updatedAt: string;
  currentPrice?: number; // Fetched/Simulated
}

export interface Transaction {
  id?: string;
  assetSymbol: string;
  type: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: string;
}

export interface PortfolioStats {
  totalValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPercent: number;
  dailyChange: number;
  dailyChangePercent: number;
}

export interface HistoryPoint {
  id?: string;
  date: string; // YYYY-MM-DD
  value: number;
}
