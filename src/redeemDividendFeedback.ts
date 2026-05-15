import { formatCurrency } from './formatCurrency';

export const REDEEM_MUTE_STORAGE_KEY = 'bors_dividend_redeem_muted';

export function isRedeemMuted(): boolean {
  try {
    return localStorage.getItem(REDEEM_MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setRedeemMuted(muted: boolean): void {
  try {
    localStorage.setItem(REDEEM_MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Short synthesized chime — only call from a user gesture (redeem click). */
export function playRedeemChime(): void {
  if (prefersReducedMotion() || isRedeemMuted()) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
    osc.onended = () => void ctx.close();
  } catch {
    /* autoplay or AudioContext unsupported */
  }
}

export function formatRedeemAnnouncement(name: string, amountEur: number): string {
  return `Received ${formatCurrency(amountEur, 'EUR')} from ${name}`;
}
