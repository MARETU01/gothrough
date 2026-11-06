import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

export function RefreshButton({ loading, disabled, onClick, label }: {
  loading?: boolean; disabled?: boolean; onClick: () => void; label?: string;
}) {
  const { t } = useTranslation();
  return <Button type="button" variant="outline" disabled={loading || disabled} aria-busy={loading} onClick={onClick}>
    <RefreshCw aria-hidden="true" className={loading ? 'app-spin' : undefined} />{loading ? t('加载中…') : label ?? t('刷新')}
  </Button>;
}
