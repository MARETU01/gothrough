import { useTranslation } from 'react-i18next';
import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import './Navigation.css';
import { useSharedUploadQueue } from '@/contexts/UploadQueueContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { House, Menu, X } from 'lucide-react';
import { features } from '@/config/features';
import { LogoutButton } from '@/components/LogoutButton';

// Feature routes and cards use the same registry.
const navigationItems = [
  { path: '/', label: '主页', icon: House },
  ...features,
];

export const Navigation: React.FC = () => {
  const { t } = useTranslation();
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
      // Native dialogs own Escape while they are open (for example logout).
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
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
            <LogoutButton />
          </div>
        </div>
      </div>
    </nav>
  );
};
