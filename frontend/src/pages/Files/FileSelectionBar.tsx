import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmPanel } from '@/components/ConfirmActions';
import { downloadSelectionUrl } from '@/services/files';

export function FileSelectionBar({ names, pageNames, disabled, confirming, busy, onSelectAll, onClear, onRequest, onCancel, onConfirm }: {
  names: string[]; pageNames: string[]; disabled: boolean; confirming: boolean; busy: boolean;
  onSelectAll: () => void; onClear: () => void; onRequest: () => void; onCancel: () => void; onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(false);
  const restoreRequested = useRef(false);
  useEffect(() => {
    if ((wasBusy.current && !busy) || (restoreRequested.current && !confirming && !busy)) {
      const target = names.length ? trigger.current : selectAll.current;
      if (target && !target.disabled) target.focus(); else region.current?.focus();
      restoreRequested.current = false;
    }
    wasBusy.current = busy;
  }, [busy, confirming, names.length]);
  const visibleSelected = pageNames.filter(name => names.includes(name)).length;
  const all = pageNames.length > 0 && visibleSelected === pageNames.length;
  const url = downloadSelectionUrl(names);
  const downloadAvailable = names.length > 0 && url.split('?')[1].length <= 64 * 1024;
  function cancel() { restoreRequested.current = true; onCancel(); }
  return <div className="files-selection" role="group" aria-label={t('batch.selection')} ref={region} tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape' && confirming && !busy) { event.preventDefault(); cancel(); }
  }}>
    <div className="files-selection-controls">
      <label className="files-select-all"><input type="checkbox" ref={node => {
        selectAll.current = node;
        if (node) node.indeterminate = visibleSelected > 0 && !all;
      }} checked={all} disabled={disabled || pageNames.length === 0 || busy || confirming}
        onChange={() => { if (all) onClear(); else onSelectAll(); }} />{t('batch.selectPage')}</label>
      <span role="status">{t('batch.selected', { count: names.length })}</span>
      {names.length > 0 && <>
        {downloadAvailable && !busy && !confirming ? <Button asChild variant="outline"><a href={url} download><Download aria-hidden="true" />{t('batch.download')}</a></Button>
          : <Button type="button" variant="outline" disabled><Download aria-hidden="true" />{t('batch.download')}</Button>}
        <Button type="button" variant="destructive" ref={trigger} disabled={busy || confirming} onClick={onRequest}>{t('batch.delete')}</Button>
        <Button type="button" variant="ghost" disabled={busy || confirming} onClick={() => { onClear(); selectAll.current?.focus(); }}>{t('batch.clear')}</Button>
      </>}
    </div>
    {names.length > 0 && !downloadAvailable && <p className="files-sync-note">{t('batch.longDownload')}</p>}
    {confirming && <>
      <ConfirmPanel message={t('batch.confirm', { count: names.length })} busy={busy} onConfirm={onConfirm} onCancel={cancel} />
      <p>{t('batch.recursive')}</p>
      <ul className="files-selection-names">{names.slice(0, 5).map(name => <li key={name}>{name}</li>)}</ul>
      {names.length > 5 && <p>{t('batch.more', { count: names.length - 5 })}</p>}
    </>}
  </div>;
}
