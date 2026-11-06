import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import './Navigation.css';
import { useSharedUploadQueue } from '@/contexts/UploadQueueContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

// 顶部导航组件
export const Navigation: React.FC = () => {
  const { t } = useTranslation();
  const { running, globalPaused, canceling } = useSharedUploadQueue();
  return (
    <nav className="navigation" aria-label={t("主导航")}>
      <div className="nav-container">
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>{t("主页")}</NavLink>
        <NavLink to="/upload" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>{t("文件上传")}{running && <span className="nav-upload-status"> · {canceling ? t("取消中") : globalPaused ? t("已暂停") : t("进行中")}</span>}
        </NavLink>
        <NavLink to="/files" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>{t("文件列表")}</NavLink>
        <NavLink to="/clipboard" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>{t("剪贴板")}</NavLink>
        <LanguageSwitcher />
      </div>
    </nav>
  );
};
