import { NavLink } from 'react-router-dom';
import './Navigation.css';
import { useSharedUploadQueue } from '@/contexts/UploadQueueContext';

// 顶部导航组件
export const Navigation: React.FC = () => {
  const { running, globalPaused, canceling } = useSharedUploadQueue();
  return (
    <nav className="navigation" aria-label="主导航">
      <div className="nav-container">
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          主页
        </NavLink>
        <NavLink to="/upload" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          文件上传{running && <span className="nav-upload-status"> · {canceling ? '取消中' : globalPaused ? '已暂停' : '进行中'}</span>}
        </NavLink>
        <NavLink to="/files" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          文件列表
        </NavLink>
      </div>
    </nav>
  );
};
