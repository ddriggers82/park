'use client';

import { useFormStatus } from 'react-dom';

interface Props {
  children: React.ReactNode;
  message: string;
  className?: string;
  variant?: 'primary' | 'secondary' | 'destructive';
}

function Inner({ children, message, className, variant = 'destructive' }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className ?? `btn btn-${variant}`}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {pending ? 'Saving...' : children}
    </button>
  );
}

export function ConfirmSubmit(props: Props) {
  return <Inner {...props} />;
}
