import React from 'react';
import { motion } from 'motion/react';

const NAV_SHORT: Record<string, string> = {
  Dashboard: 'Home',
  'Dividend engine': 'Divs',
  FIRE: 'FIRE',
  Market: 'Market',
  Options: 'Opts',
};

export const NavButton = ({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) => (
  <motion.button
    type="button"
    onClick={onClick}
    title={label}
    whileTap={{ scale: 0.96 }}
    transition={{ duration: 0.12 }}
    className={`group relative flex flex-col items-center gap-1 p-3 xl:py-2.5 rounded-xl transition-all w-full ${
      active ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-text-s hover:text-text-p hover:bg-white/5'
    }`}
  >
    {icon}
    <span className="hidden xl:block text-[8px] font-bold uppercase tracking-wide leading-tight text-center max-w-[4.5rem]">
      {NAV_SHORT[label] ?? label}
    </span>
    <span className="xl:hidden absolute left-full ml-3 opacity-0 group-hover:opacity-100 transition-opacity bg-card border border-border px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest pointer-events-none whitespace-nowrap z-50">
      {label}
    </span>
  </motion.button>
);
