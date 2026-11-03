import React from 'react';
import { motion } from 'motion/react';

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
    <span className="hidden xl:block text-xs font-medium leading-tight text-center">
      {label}
    </span>
    <span className="xl:hidden absolute left-full ml-3 opacity-0 group-hover:opacity-100 transition-opacity bg-card border border-border px-3 py-1.5 rounded-lg text-xs font-medium pointer-events-none whitespace-nowrap z-50">
      {label}
    </span>
  </motion.button>
);
