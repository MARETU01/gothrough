import { BrowserRouter as Router } from 'react-router-dom';
import { AppRoutes } from './router';
import { UploadQueueProvider } from '@/contexts/UploadQueueProvider';
import { AccessGate } from '@/components/AccessGate';

const App: React.FC = () => {
  return (
    <Router>
      <AccessGate>
        <UploadQueueProvider>
          <AppRoutes />
        </UploadQueueProvider>
      </AccessGate>
    </Router>
  );
};

export default App;

