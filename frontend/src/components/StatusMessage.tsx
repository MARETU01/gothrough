import { createElement, type ReactNode } from 'react';
import { CircleCheck, CircleAlert, Info, LoaderCircle } from 'lucide-react';

export function StatusMessage({ children, tone = 'info', action }: {
  children: ReactNode;
  tone?: 'success' | 'error' | 'info' | 'loading';
  action?: ReactNode;
}) {
  const Icon = { success: CircleCheck, error: CircleAlert, info: Info, loading: LoaderCircle }[tone];
  return createElement('div', { className: `app-message app-message-${tone}`, role: tone === 'error' ? 'alert' : 'status' },
    createElement(Icon, { size: 18, 'aria-hidden': true, className: tone === 'loading' ? 'app-spin' : undefined }),
    createElement('span', null, children), action,
  );
}
