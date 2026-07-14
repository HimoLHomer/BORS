/** Optional UI sounds — respects reduced motion; user mute in Options. */

export const UI_SOUNDS_MUTE_KEY = 'bors_ui_sounds_muted';
/** @deprecated use UI_SOUNDS_MUTE_KEY */
export const REDEEM_MUTE_STORAGE_KEY = 'bors_dividend_redeem_muted';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isUiSoundsMuted(): boolean {
  try {
    if (localStorage.getItem(UI_SOUNDS_MUTE_KEY) === '1') return true;
    if (localStorage.getItem(REDEEM_MUTE_STORAGE_KEY) === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function setUiSoundsMuted(muted: boolean): void {
  try {
    localStorage.setItem(UI_SOUNDS_MUTE_KEY, muted ? '1' : '0');
    localStorage.setItem(REDEEM_MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** @deprecated use isUiSoundsMuted */
export const isRedeemMuted = isUiSoundsMuted;

/** @deprecated use setUiSoundsMuted */
export const setRedeemMuted = setUiSoundsMuted;

function playTone(freqStart: number, freqEnd: number, peakGain: number, durationSec: number): void {
  if (prefersReducedMotion() || isUiSoundsMuted()) return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, now + durationSec * 0.25);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.05);
    osc.onended = () => void ctx.close();
  } catch {
    /* unsupported */
  }
}

/** Dividend redeem — call from user gesture only. */
export function playRedeemChime(): void {
  playTone(523.25, 783.99, 0.22, 0.35);
}

/** New holding saved — softer confirm ping. */
export function playAssetAddedChime(): void {
  playTone(440, 554.37, 0.16, 0.22);
}

/** FIRE annual savings goal reached — warm ascending pair. */
export function playFireGoalChime(): void {
  playTone(392, 659.25, 0.2, 0.4);
}

/** Portfolio milestone crossed — brief ascending arpeggio. */
export function playMilestoneChime(): void {
  if (prefersReducedMotion() || isUiSoundsMuted()) return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const noteDuration = 0.14;
    const stagger = 0.07;
    let pending = notes.length;

    notes.forEach((freq, i) => {
      const t0 = ctx.currentTime + i * stagger;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.17, t0 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + noteDuration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + noteDuration + 0.03);
      osc.onended = () => {
        pending -= 1;
        if (pending <= 0) void ctx.close();
      };
    });
  } catch {
    /* unsupported */
  }
}
