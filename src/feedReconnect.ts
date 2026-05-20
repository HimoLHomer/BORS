/** Dispatched when Yahoo health transitions from offline/connecting to connected. */
export const FEED_RECONNECTED_EVENT = 'bors-feed-reconnected';

export function dispatchFeedReconnected(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(FEED_RECONNECTED_EVENT));
}

export function onFeedReconnected(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(FEED_RECONNECTED_EVENT, handler);
  return () => window.removeEventListener(FEED_RECONNECTED_EVENT, handler);
}

/** Run `retry` when the tab becomes visible or the browser reports network online. */
export function subscribeAcceleratedFeedRetry(retry: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const run = () => {
    if (document.visibilityState === 'hidden') return;
    retry();
  };

  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', run);
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', run);
  };
}
