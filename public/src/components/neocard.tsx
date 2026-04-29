import React from 'react';

interface Props {
  children: React.ReactNode;
  className?: string;
}

export const NeoCard: React.FC<Props> = ({ children, className = '' }) => {
  return (
    <div
      className={`rounded-[28px] border border-white/15 bg-[#04080a]/75 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.28)] ${className}`}
    >
      {children}
    </div>
  );
};
