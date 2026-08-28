import { Outlet } from 'react-router-dom';
import { Navigation } from './Navigation';

// 根布局：顶部导航 + 路由出口（替代原来在 App.tsx 里手写的 <div className="app"> 包装）
export const RootLayout: React.FC = () => {
  return (
    <div className="app">
      <Navigation />
      <Outlet />
    </div>
  );
};
