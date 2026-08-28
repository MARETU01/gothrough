import { BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Navigation, AppRoutes } from './router/Routes';

// 主应用包装器
const App: React.FC = () => {
  return (
    <Router>
      <TooltipProvider>
        <div className="app">
          <Navigation />
          <AppRoutes />
        </div>
        <Toaster />
      </TooltipProvider>
    </Router>
  );
};

export default App;
