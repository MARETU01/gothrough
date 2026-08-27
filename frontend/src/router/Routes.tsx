import { Routes, Route, Link } from 'react-router-dom';
import './Navigation.css';
import HomePage from '../pages/Home/HomePage.tsx';
import UploadPage from '../pages/Upload/UploadPage.tsx';

// 创建一个简单的导航组件
export const Navigation: React.FC = () => {
  return (
    <nav className="navigation">
      <div className="nav-container">
        <a href="/" className="nav-link">
          主页
        </a>
        <Link to="/upload" className="nav-link">
          文件上传
        </Link>
      </div>
    </nav>
  );
};

// 路由配置组件
export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/upload" element={<UploadPage />} />
    </Routes>
  );
};