import React from 'react';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hideLabel?: boolean;
  containerClassName?: string;
}

export const NeoInput: React.FC<Props> = ({
  label,
  hideLabel = false,
  className = '',
  containerClassName = '',
  ...props
}) => {
  return (
    <div className={`mb-4 ${containerClassName}`}>
      {!hideLabel && label ? <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-[#8ca198]">{label}</label> : null}
      <input
        {...props}
        className={`w-full rounded-[16px] border border-white/12 bg-black/28 px-4 py-3 text-neo-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] placeholder-[#61756d] transition-all focus:border-neo-accent/60 focus:-translate-y-[1px] focus:outline-none ${className}`}
      />
    </div>
  );
};
