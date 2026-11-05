import { Link } from 'react-router-dom';
import { ArrowRight, Clipboard, Files, Upload, MonitorSmartphone } from 'lucide-react';
import './HomePage.css';

const features = [
  {
    path: '/upload', title: '文件上传', icon: Upload, action: '开始上传',
    description: '拖入文件或文件夹，保留目录结构。支持多文件队列、暂停和失败重试。',
  },
  {
    path: '/files', title: '文件列表', icon: Files, action: '查看文件',
    description: '查找、下载和管理已上传的文件，随时了解文件大小与磁盘空间。',
  },
  {
    path: '/clipboard', title: '共享剪贴板', icon: Clipboard, action: '分享文本',
    description: '粘贴并发布一段文字，在另一台设备查看和复制，历史记录自动保存。',
  },
];

export default function HomePage() {
  return (
    <main className="home-page">
      <div className="home-container">
        <header className="home-header">
          <p className="home-eyebrow">文件与文本共享</p>
          <h1>GoThrough</h1>
          <p className="home-intro">在设备之间，分享文件与文字。</p>
          <p className="home-description">上传文件、管理已上传内容，或用共享剪贴板传递一段文字。</p>
        </header>

        <nav className="home-features" aria-label="功能入口">
          {features.map(({ path, title, icon: Icon, action, description }) => (
            <Link key={path} to={path} className="home-feature" aria-labelledby={`home${path}`}>
              <span className="home-feature-icon"><Icon aria-hidden="true" /></span>
              <h2 id={`home${path}`}>{title}</h2>
              <p>{description}</p>
              <span className="home-feature-action">{action}<ArrowRight aria-hidden="true" /></span>
            </Link>
          ))}
        </nav>

        <aside className="home-sharing" aria-label="跨设备使用提示">
          <MonitorSmartphone aria-hidden="true" />
          <div>
            <h2>换一台设备，继续分享</h2>
            <p>在另一台可访问此服务的设备上打开相同地址，即可下载文件或查看共享文本。剪贴板的新内容可通过「刷新」获取。</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
