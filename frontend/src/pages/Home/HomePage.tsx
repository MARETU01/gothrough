import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { ArrowRight, MonitorSmartphone } from 'lucide-react';
import './HomePage.css';
import { features } from '@/config/features';

export default function HomePage() {
  const { t } = useTranslation();
  usePageTitle(t("app.title"));

  return (
    <main className="home-page">
      <div className="home-container">
        <header className="home-header">
          <p className="home-eyebrow">{t("文件与文本共享")}</p>
          <h1>GoThrough</h1>
          <p className="home-intro">{t("在设备之间，分享文件与文字。")}</p>
          <p className="home-description">{t("上传文件、管理已上传内容，或用共享剪贴板传递一段文字。")}</p>
        </header>

        <nav className="home-features" aria-label={t("功能入口")}>
          {features.map(({ path, title, icon: Icon, action, description }) => (
            <Link key={path} to={path} className="home-feature" aria-labelledby={`home${path}`}>
              <span className="home-feature-icon"><Icon aria-hidden="true" /></span>
              <h2 id={`home${path}`}>{t(title)}</h2>
              <p>{t(description)}</p>
              <span className="home-feature-action">{t(action)}<ArrowRight aria-hidden="true" /></span>
            </Link>
          ))}
        </nav>

        <aside className="home-sharing" aria-label={t("跨设备使用提示")}>
          <MonitorSmartphone aria-hidden="true" />
          <div>
            <h2>{t("换一台设备，继续分享")}</h2>
            <p>{t("在另一台可访问此服务的设备上打开相同地址，即可下载文件或查看共享文本。剪贴板页面会自动获取最新内容，也可手动刷新。")}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
