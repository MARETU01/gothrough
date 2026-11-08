import { lazy } from 'react';
import { Clipboard, Files, Upload } from 'lucide-react';

// Shared by routes, navigation, and home cards. Keep pages lazy-loaded.
export const features = [
  { path: '/upload', label: '文件上传', title: '文件上传', icon: Upload, action: '开始上传',
    description: '拖入文件或文件夹，保留目录结构。支持多文件队列、暂停和失败重试。',
    component: lazy(() => import('@/pages/Upload/UploadPage')) },
  { path: '/files', label: '文件列表', title: '文件列表', icon: Files, action: '查看文件',
    description: '查找、下载和管理已上传的文件，随时了解文件大小与磁盘空间。',
    component: lazy(() => import('@/pages/Files/FilesPage')) },
  { path: '/clipboard', label: '剪贴板', title: '共享剪贴板', icon: Clipboard, action: '分享文本',
    description: '粘贴并发布一段文字，在另一台设备查看和复制，历史记录自动保存。',
    component: lazy(() => import('@/pages/Clipboard/ClipboardPage')) },
];
