import { Routes, Route } from 'react-router-dom';
import HomePage from '../pages/Home/HomePage.tsx';

// 创建一个简单的导航组件
export const Navigation: React.FC = () => {
  return (
    <nav className="navigation">
      <div className="nav-container">
        <a href="/" className="nav-link">
          主页
        </a>
      </div>
    </nav>
  );
};

// 路由配置组件
export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
};