import { Routes, Route, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RootLayout } from './layouts/RootLayout';
import HomePage from './pages/Home/HomePage';
import { features } from './config/features';


// 路由配置：使用布局路由模式，RootLayout 提供导航 + <Outlet/>，子路由页面在内部渲染
export const AppRoutes: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<HomePage />} />
        {features.map(({ path, component: Page }) => <Route key={path} path={path} element={<Page />} />)}
        <Route path="*" element={<main className="not-found"><h1>{t('route.notFound')}</h1><Link to="/">{t('route.home')}</Link></main>} />
      </Route>
    </Routes>
  );
};
