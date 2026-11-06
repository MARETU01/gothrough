import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/utils/dateTime';

export function Timestamp({ value }: { value: string }) {
  const { i18n } = useTranslation();
  return <time dateTime={value.replace(' ', 'T')}>{formatDateTime(value, i18n.resolvedLanguage)}</time>;
}
