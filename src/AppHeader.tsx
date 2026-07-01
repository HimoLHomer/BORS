import React from 'react';
import { RefreshCcw } from 'lucide-react';
import { BorsMark } from './BorsMark';

export const LoadingScreen = () => (
  <div className="fixed inset-0 bg-bg flex items-center justify-center z-50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
      <div className="flex items-center gap-2 leading-none">
        <BorsMark className="w-7 h-7 shrink-0 opacity-90" />
        <span className="font-black text-2xl tracking-tighter text-text-p uppercase">BÖRS</span>
      </div>
      <p className="text-[10px] text-text-s font-mono uppercase tracking-widest animate-pulse">Initializing Market Feed</p>
    </div>
  </div>
);

export const AppHeader = ({
  apiStatus,
  feedDetail,
  onRetryFeed,
  feedRetrying,
}: {
  apiStatus: 'connecting' | 'connected' | 'error';
  feedDetail: string | null;
  onRetryFeed: () => void;
  feedRetrying: boolean;
}) => (
  <header className="border-b border-border bg-bg px-6 py-4 flex items-center justify-between">
    <div className="flex items-center gap-2 leading-none">
      <BorsMark className="w-6 h-6 shrink-0 opacity-90" />
      <span className="font-black text-xl tracking-tighter text-text-p uppercase">BÖRS</span>
    </div>
    
    <div className="flex items-center gap-8">
      <div className="hidden md:flex items-center gap-8 text-[10px] text-text-s font-bold uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            Feed: {apiStatus === 'connected' ? (
              <span className="text-green flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green shrink-0" aria-hidden />
                Yahoo Live
              </span>
            ) : apiStatus === 'connecting' ? (
              <span className="text-text-s flex items-center gap-1.5">
                <RefreshCcw className="w-3 h-3 animate-spin shrink-0" aria-hidden />
                Connecting…
              </span>
            ) : (
              <span
                className="text-red flex items-center gap-1.5 max-w-[min(320px,35vw)] truncate cursor-help"
                title={feedDetail ?? 'Yahoo health check failed. Run npm run dev (Express + Vite) and ensure outbound network allows Yahoo Finance.'}
              >
                Offline
              </span>
            )}
          </div>
          {apiStatus !== 'connected' && (
            <button
              type="button"
              onClick={onRetryFeed}
              disabled={feedRetrying}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 text-text-s hover:bg-white/10 hover:text-text-p transition-all text-[9px] font-bold uppercase tracking-widest disabled:opacity-40"
              title={feedDetail ?? 'Retry Yahoo market feed'}
            >
              <RefreshCcw className={`w-3 h-3 shrink-0 ${feedRetrying ? 'animate-spin' : ''}`} aria-hidden />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  </header>
);
