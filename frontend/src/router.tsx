import { Routes, Route } from 'react-router-dom';
import { RootLayout } from './layouts/RootLayout';
import HomePage from './pages/Home/HomePage';
import UploadPage from './pages/Upload/UploadPage';

// 路由配置：使用布局路由模式，RootLayout 提供导航 + <Outlet/>，子路由页面在内部渲染
export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/upload" element={<UploadPage />} />
      </Route>
    </Routes>
  );
};
