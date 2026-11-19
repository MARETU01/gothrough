import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { StatusMessage } from './StatusMessage';

type View = { zoom: number | null; x: number; y: number };
type Point = { x: number; y: number };
const initialView: View = { zoom: null, x: 0, y: 0 };

export function ZoomableImage({ url, name, onError, onLoad }: { url: string; name: string; onError: () => void; onLoad?: () => void }) {
  const { t } = useTranslation();
  const stage = useRef<HTMLDivElement>(null);
  const points = useRef(new Map<number, Point>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>(initialView);
  const loaded = natural.width > 0;
  const fit = loaded && size.width > 0 ? Math.min(1, size.width / natural.width, size.height / natural.height) : 1;
  const scale = view.zoom ?? fit;
  const limit = (value: View): View => {
    const zoom = value.zoom === null ? null : Math.max(Math.min(fit, 0.1), Math.min(8, value.zoom));
    const actual = zoom ?? fit;
    const dx = Math.max(0, (natural.width * actual - size.width) / 2);
    const dy = Math.max(0, (natural.height * actual - size.height) / 2);
    return { zoom, x: Math.max(-dx, Math.min(dx, value.x)), y: Math.max(-dy, Math.min(dy, value.y)) };
  };
  const displayed = limit(view);
  const zoomAt = (factor: number, anchor: Point = { x: 0, y: 0 }) => setView(current => {
    const old = limit(current);
    const previous = old.zoom ?? fit;
    const next = limit({ ...old, zoom: previous * factor });
    const ratio = next.zoom! / previous;
    return limit({ zoom: next.zoom, x: anchor.x - (anchor.x - old.x) * ratio, y: anchor.y - (anchor.y - old.y) * ratio });
  });
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelHandler.current = event => {
      event.preventDefault();
      if (!loaded) return;
      const rect = stage.current!.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
    };
  });
  useEffect(() => {
    const element = stage.current!;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    const wheel = (event: WheelEvent) => wheelHandler.current(event);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); element.removeEventListener('wheel', wheel); };
  }, []);
  return <div className="image-viewer">
    <div className="image-viewer-toolbar" role="group" aria-label={t('preview.imageTools')}>
      <Button variant="outline" disabled={!loaded || scale <= Math.min(fit, 0.1)} onClick={() => zoomAt(1 / 1.25)} aria-label={t('preview.zoomOut')}>−</Button>
      <output aria-live="polite">{Math.round(scale * 100)}%</output>
      <Button variant="outline" disabled={!loaded || scale >= 8} onClick={() => zoomAt(1.25)} aria-label={t('preview.zoomIn')}>+</Button>
      <Button variant="outline" disabled={!loaded} onClick={() => setView(initialView)}>{t('preview.fit')}</Button>
      <Button variant="outline" disabled={!loaded} onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>{t('preview.actualSize')}</Button>
    </div>
    <p className="image-viewer-hint">{t('preview.imageHint')}</p>
    {!loaded && <StatusMessage tone="loading">{t('preview.loading')}</StatusMessage>}
    <div ref={stage} className="image-viewer-stage" tabIndex={0} role="region" aria-label={t('preview.imageCanvas')}
      onKeyDown={event => {
        if (!loaded) return;
        if (event.key === '+' || event.key === '=') zoomAt(1.25);
        else if (event.key === '-') zoomAt(1 / 1.25);
        else if (event.key === '0') setView(initialView);
        else if (event.key === '1') setView({ zoom: 1, x: 0, y: 0 });
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          setView(current => limit({ ...current, x: current.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: current.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) }));
        } else return;
        event.preventDefault();
      }}
      onDoubleClick={() => setView(scale === fit ? { zoom: 1, x: 0, y: 0 } : initialView)}
      onPointerDown={event => {
        if (!loaded || (event.pointerType === 'mouse' && event.button !== 0)) return;
        stage.current!.setPointerCapture(event.pointerId);
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }}
      onPointerMove={event => {
        const previous = [...points.current.values()];
        if (!points.current.has(event.pointerId)) return;
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const next = [...points.current.values()];
        if (next.length === 1) setView(current => limit({ ...current, x: current.x + next[0].x - previous[0].x, y: current.y + next[0].y - previous[0].y }));
        else if (next.length === 2) {
          const distance = (p: Point[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
          const before = distance(previous);
          if (before < 1) return;
          const rect = stage.current!.getBoundingClientRect();
          const anchor = { x: (previous[0].x + previous[1].x) / 2 - rect.left - rect.width / 2, y: (previous[0].y + previous[1].y) / 2 - rect.top - rect.height / 2 };
          zoomAt(distance(next) / before, anchor);
          setView(current => limit({ ...current, x: current.x + (next[0].x + next[1].x - previous[0].x - previous[1].x) / 2, y: current.y + (next[0].y + next[1].y - previous[0].y - previous[1].y) / 2 }));
        }
      }}
      onLostPointerCapture={event => points.current.delete(event.pointerId)}
      onPointerUp={event => points.current.delete(event.pointerId)}
      onPointerCancel={event => points.current.delete(event.pointerId)}>
      <img src={url} alt={name} draggable={false} onError={onError}
        onLoad={event => { setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); onLoad?.(); }}
        style={{ width: natural.width || undefined, height: natural.height || undefined, visibility: loaded ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${displayed.x}px, ${displayed.y}px) scale(${scale})` }} />
    </div>
  </div>;
}
