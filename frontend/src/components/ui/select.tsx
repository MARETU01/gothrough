import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';
import './select.css';

// Keep native select semantics, keyboard navigation, and mobile pickers.
export function Select({ className, ...props }: Omit<ComponentProps<'select'>, 'multiple' | 'size'>) {
  return <span className="app-select" data-disabled={props.disabled || undefined}>
    <select {...props} className={cn('app-select-control', className)} />
    <ChevronDown className="app-select-arrow" aria-hidden="true" />
  </span>;
}
