import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LockKeyhole, ArrowRight, ShieldCheck } from 'lucide-react';
import { responseApi } from '@/services/http';
import { AccessContext } from '@/contexts/AccessContext';
import { useEditorDraft } from '@/contexts/EditorDraftContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Button } from './ui/button';
import { StatusMessage } from './StatusMessage';
import { RefreshButton } from './RefreshButton';
import './AccessGate.css';

type AccessState = { enabled: boolean; authenticated: boolean };

export function AccessGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { draft: preservedDraft } = useEditorDraft();
  const [access, setAccess] = useState<AccessState | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await responseApi.get<AccessState>('/auth/status', { signal });
      if (signal?.aborted) return;
      setAccess(response.data);
      setError('');
    } catch { if (!signal?.aborted) setError('auth.unavailable'); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Synchronize with the server session; cancel stale requests on unmount.
    // oxlint-disable-next-line react/set-state-in-effect
    void check(controller.signal);
    return () => controller.abort();
  }, [check]);
  useEffect(() => {
    // Cleanup requests may receive 401 after a deliberate logout. They must
    // not turn the already locked page into a spurious session-expired error.
    if (!access?.authenticated) return;
    const lock = () => { setAccess({ enabled: true, authenticated: false }); setError('auth.expired'); };
    window.addEventListener('gothrough:auth-required', lock);
    return () => window.removeEventListener('gothrough:auth-required', lock);
  }, [access?.authenticated]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await responseApi.post<AccessState>('/auth/login', { password });
      setPassword('');
      setAccess(response.data);
    } catch (cause) {
      const status = (cause as { response?: { status?: number } }).response?.status;
      setError(status === 401 ? 'auth.invalid' : status === 429 ? 'auth.rateLimited' : 'auth.unavailable');
    } finally { setBusy(false); }
  }

  async function logout() {
    setError('');
    try {
      await responseApi.post('/auth/logout');
      setPassword('');
      setAccess({ enabled: true, authenticated: false });
    } catch { setError('auth.unavailable'); }
  }

  if (access?.authenticated) {
    return <AccessContext.Provider value={{ enabled: access.enabled, logout }}>
      {error && <div className="access-session-error"><StatusMessage tone="error">{t(error)}</StatusMessage></div>}
      {children}
    </AccessContext.Provider>;
  }

  return <main className="access-page">
    <header className="access-header"><div className="access-header-content"><a href="/" className="access-brand">GoThrough<span>{t('auth.sharedSpace')}</span></a><LanguageSwitcher /></div></header>
    <section className="content-container access-card" aria-labelledby="access-title">
      <div className="access-icon"><LockKeyhole size={26} aria-hidden="true" /></div>
      <span className="access-eyebrow">{t('auth.privateSpace')}</span>
      <h1 id="access-title">{t('auth.title')}</h1>
      <p className="access-description">{t('auth.description')}</p>
      {preservedDraft && <StatusMessage>{t('auth.draftPreserved')}</StatusMessage>}
      {access ? <form onSubmit={event => void login(event)}>
        <label htmlFor="access-password">{t('auth.password')}</label>
        <input id="access-password" type="password" autoComplete="current-password" autoFocus maxLength={256} placeholder={t('auth.placeholder')} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} aria-describedby={error ? 'access-error' : undefined} aria-invalid={error === 'auth.invalid'} />
        {error && <div className="access-feedback" id="access-error"><StatusMessage tone="error">{t(error)}</StatusMessage></div>}
        <Button className="access-submit" type="submit" disabled={busy || !password}>{t(busy ? 'auth.verifying' : 'auth.unlock')}<ArrowRight aria-hidden="true" /></Button>
      </form> : <div aria-live="polite">{error ? <StatusMessage tone="error" action={<RefreshButton onClick={() => void check()} label={t('auth.retry')} />}>{t(error)}</StatusMessage> : <StatusMessage tone="loading">{t('auth.checking')}</StatusMessage>}</div>}
      <div className="access-note"><ShieldCheck size={16} aria-hidden="true" /><span>{t('auth.sessionNote')}</span></div>
    </section>
    <footer className="access-footer">{t('auth.footer')}</footer>
  </main>;
}
