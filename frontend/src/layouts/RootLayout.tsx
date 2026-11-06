import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { Navigation } from './Navigation';
import { StatusMessage } from '@/components/StatusMessage';

// 根布局：顶部导航 + 路由出口（替代原来在 App.tsx 里手写的 <div className="app"> 包装）
export const RootLayout: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="app">
      <Navigation />
      <Suspense fallback={
        <main className="content-page" aria-busy="true">
          <div className="content-container">
            <StatusMessage tone="loading">{t('route.loading')}</StatusMessage>
          </div>
        </main>
      }>
        <Outlet />
      </Suspense>
    </div>
  );
};
