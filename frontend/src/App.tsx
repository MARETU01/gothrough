import { BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppRoutes } from './router';

// 主应用包装器：<div className="app"> + 导航 已移入 RootLayout（布局路由模式）
const App: React.FC = () => {
  return (
    <Router>
      <TooltipProvider>
        <AppRoutes />
        <Toaster />
      </TooltipProvider>
    </Router>
  );
};

export default App;

