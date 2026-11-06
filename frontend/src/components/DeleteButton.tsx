import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { ConfirmActions } from './ConfirmActions';

type DeleteButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'asChild' | 'children'> & { all?: boolean };

// Single and bulk deletion share the same destructive appearance and icon.
export function DeleteButton({ all = false, ...props }: DeleteButtonProps) {
  const { t } = useTranslation();
  return <Button type="button" {...props} variant="destructive"><Trash2 aria-hidden="true" />{t(all ? '全部删除' : '删除')}</Button>;
}

export function DeleteAction({ confirming, disabled, busy, size = 'default', label, confirmLabel, onRequest, onConfirm, onCancel }: {
  confirming: boolean; disabled?: boolean; busy?: boolean; size?: 'default' | 'sm';
  label: string; confirmLabel: string; onRequest: () => void; onConfirm: () => void; onCancel: () => void;
}) {
  return confirming ? <ConfirmActions onConfirm={onConfirm} onCancel={onCancel} disabled={disabled} busy={busy} size={size} confirmAriaLabel={confirmLabel} />
    : <DeleteButton size={size} disabled={disabled || busy} aria-label={label} onClick={onRequest} />;
}
