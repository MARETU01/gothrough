import { Link } from 'react-router-dom';
import './Navigation.css';

// 顶部导航组件
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
