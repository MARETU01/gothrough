import { useTranslation } from 'react-i18next';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { AccessContext } from '@/contexts/AccessContext';
import { NavLink, useLocation } from 'react-router-dom';
import './Navigation.css';
import { useSharedUploadQueue } from '@/contexts/UploadQueueContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { Clipboard, Files, House, LockKeyhole, Menu, Upload, X } from 'lucide-react';

// Add future pages here so desktop and mobile navigation stay in sync.
const navigationItems = [
  { path: '/', label: '主页', icon: House },
  { path: '/upload', label: '文件上传', icon: Upload },
  { path: '/files', label: '文件列表', icon: Files },
  { path: '/clipboard', label: '剪贴板', icon: Clipboard },
];

export const Navigation: React.FC = () => {
  const { t } = useTranslation();
  const access = useContext(AccessContext);
  const location = useLocation();
  const [expandedAt, setExpandedAt] = useState<string | null>(null);
  const expanded = expandedAt === location.key;
  const panelId = useId();
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { running, globalPaused, canceling } = useSharedUploadQueue();
  const current = navigationItems.find(item => item.path === '/' ? location.pathname === '/' :
    location.pathname === item.path || location.pathname.startsWith(`${item.path}/`));
  const uploadStatus = canceling ? t('取消中') : globalPaused ? t('已暂停') : t('进行中');

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setExpandedAt(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setExpandedAt(null);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  function closeMenu() {
    setExpandedAt(null);
    if (toggleRef.current?.getClientRects().length) toggleRef.current.focus();
  }

  return (
    <nav ref={navRef} className="navigation" aria-label={t('主导航')}>
      <div className="nav-container">
        <div className="nav-mobile-header">
          <div className="nav-mobile-title"><span className="nav-brand">GoThrough</span><span>{current ? t(current.label) : t('主导航')}</span></div>
          {running && <span className="nav-mobile-status">{t('文件上传')} · {uploadStatus}</span>}
          <Button ref={toggleRef} className="nav-toggle" variant="outline" type="button"
            aria-expanded={expanded} aria-controls={panelId}
            aria-label={t(expanded ? 'nav.close' : 'nav.open')}
            onClick={() => setExpandedAt(expanded ? null : location.key)}>
            {expanded ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}<span>{t('nav.menu')}</span>
          </Button>
        </div>
        <div id={panelId} className={`nav-panel${expanded ? ' is-open' : ''}`}>
          <div className="nav-links">
            {navigationItems.map(({ path, label, icon: Icon }) => (
              <NavLink key={path} to={path} end={path === '/'} onClick={closeMenu}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <Icon className="nav-item-icon" aria-hidden="true" />
                <span>{t(label)}{path === '/upload' && running && <span className="nav-upload-status"> · {uploadStatus}</span>}</span>
              </NavLink>
            ))}
          </div>
          <div className="nav-tools">
            <LanguageSwitcher />
            {access.enabled && <Button variant="outline" type="button" onClick={() => { closeMenu(); void access.logout(); }}><LockKeyhole aria-hidden="true" />{t('auth.lock')}</Button>}
          </div>
        </div>
      </div>
    </nav>
  );
};
