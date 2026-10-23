import { createElement } from 'react';
import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';

export function ConfirmDeleteDialog({ filename, busy, onCancel, onConfirm }: {
  filename: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createElement(AlertDialog.Root, { open: filename !== null, onOpenChange: open => { if (!open && !busy) onCancel(); } },
    createElement(AlertDialog.Portal, null,
      createElement(AlertDialog.Overlay, { className: 'app-dialog-overlay' }),
      createElement(AlertDialog.Content, { className: 'app-dialog', onEscapeKeyDown: event => { if (busy) event.preventDefault(); } },
        createElement(AlertDialog.Title, null, '删除文件'),
        createElement(AlertDialog.Description, null, '确定删除 ', createElement('strong', null, filename), '？此操作无法撤销。'),
        createElement('div', { className: 'app-dialog-actions' },
          createElement(AlertDialog.Cancel, { asChild: true }, createElement(Button, { variant: 'outline', disabled: busy }, '取消')),
          createElement(Button, { variant: 'destructive', disabled: busy, onClick: onConfirm }, busy ? '删除中…' : '确认删除'),
        ),
      ),
    ),
  );
}
