import { formatCurrency } from './formatCurrency';

export {
  isRedeemMuted,
  isUiSoundsMuted,
  playAssetAddedChime,
  playRedeemChime,
  REDEEM_MUTE_STORAGE_KEY,
  setRedeemMuted,
  setUiSoundsMuted,
  UI_SOUNDS_MUTE_KEY,
} from './uiFeedback';

export function formatRedeemAnnouncement(name: string, amountEur: number): string {
  return `Received ${formatCurrency(amountEur, 'EUR')} from ${name}`;
}
