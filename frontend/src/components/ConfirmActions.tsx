import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

export function ConfirmActions({ onConfirm, onCancel, disabled, busy, size = 'default', confirmLabel, confirmAriaLabel, cancelLabel, focusCancel }: {
  onConfirm: () => void; onCancel: () => void; disabled?: boolean; busy?: boolean;
  size?: 'default' | 'sm'; confirmLabel?: string; confirmAriaLabel?: string; cancelLabel?: string; focusCancel?: boolean;
}) {
  const { t } = useTranslation();
  return <>
    <Button type="button" variant="destructive" size={size} disabled={disabled || busy} aria-label={confirmAriaLabel} onClick={onConfirm}>{busy ? t('处理中…') : confirmLabel ?? t('确认删除')}</Button>
    <Button type="button" variant="ghost" size={size} disabled={disabled || busy} autoFocus={focusCancel} onClick={onCancel}>{cancelLabel ?? t('取消')}</Button>
  </>;
}

export function ConfirmPanel({ message, ...actions }: { message: string } & Parameters<typeof ConfirmActions>[0]) {
  return <section className="app-confirm" role="group" aria-label={message}>
    <p>{message}</p>
    <div className="app-confirm-actions"><ConfirmActions {...actions} focusCancel /></div>
  </section>;
}

