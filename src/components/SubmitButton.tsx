'use client';

import { useFormStatus } from 'react-dom';

interface Props {
  children: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'destructive';
}

export function SubmitButton({ children, className, variant = 'primary' }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className ?? `btn btn-${variant}`}
    >
      {pending ? 'Saving...' : children}
    </button>
  );
}
