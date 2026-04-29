import React from 'react';
import { LoaderCircle } from 'lucide-react';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'secondary';
  loading?: boolean;
}

export const NeoButton: React.FC<Props> = ({ children, variant = 'primary', loading, className = '', ...props }) => {
  const baseStyles =
    'min-h-12 rounded-[16px] border px-4 py-3 font-semibold transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';

  const variants = {
    primary:
      'border-transparent bg-[linear-gradient(135deg,#00ff9d_0%,#17ca83_100%)] text-[#03281b] shadow-[0_14px_28px_rgba(0,255,157,0.22)] hover:-translate-y-[1px] hover:shadow-[0_18px_34px_rgba(0,255,157,0.26)]',
    danger:
      'border-[#ff5d5d]/45 bg-[linear-gradient(180deg,rgba(90,16,16,0.94),rgba(45,8,8,0.92))] text-[#ffb0b0] hover:-translate-y-[1px] hover:border-[#ff5d5d]/70',
    secondary: 'border-white/15 bg-white/[0.06] text-[#eff8f3] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] hover:-translate-y-[1px] hover:border-white/25 hover:bg-white/[0.09]',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          Processing...
        </span>
      ) : (
        children
      )}
    </button>
  );
};
