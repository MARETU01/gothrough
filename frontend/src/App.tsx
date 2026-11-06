import { BrowserRouter as Router } from 'react-router-dom';
import { AppRoutes } from './router';
import { UploadQueueProvider } from '@/contexts/UploadQueueProvider';

const App: React.FC = () => {
  return (
    <Router>
      <UploadQueueProvider>
        <AppRoutes />
      </UploadQueueProvider>
    </Router>
  );
};

export default App;

