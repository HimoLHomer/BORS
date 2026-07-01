import React, { type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/** Catches render errors so the shell shows a recovery message instead of a blank page. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('BÖRS UI error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-bg text-text-p flex items-center justify-center p-8">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-xl font-black uppercase tracking-tight">Something went wrong</h1>
            <p className="text-sm text-text-s leading-relaxed">
              The dashboard hit an unexpected error. Reload the page; your portfolio data is still on disk.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-accent text-white rounded-lg text-[10px] font-black uppercase tracking-widest"
            >
              Reload BÖRS
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
