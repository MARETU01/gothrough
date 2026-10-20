import { NavLink } from 'react-router-dom';
import './Navigation.css';

// 顶部导航组件
export const Navigation: React.FC = () => {
  return (
    <nav className="navigation" aria-label="主导航">
      <div className="nav-container">
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          主页
        </NavLink>
        <NavLink to="/upload" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          文件上传
        </NavLink>
      </div>
    </nav>
  );
};
