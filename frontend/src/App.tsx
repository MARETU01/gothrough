import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppRoutes } from './router';
import { UploadQueueProvider } from '@/contexts/UploadQueueProvider';
import { AccessGate } from '@/components/AccessGate';
import { EditorDraftProvider } from '@/contexts/EditorDraftProvider';

// A data router provides blockers for browser Back/Forward as well as links.
const router = createBrowserRouter([{ path: '*', element:
  <AccessGate><UploadQueueProvider><AppRoutes /></UploadQueueProvider></AccessGate>,
}]);

const App: React.FC = () => {
  return (
    <EditorDraftProvider><RouterProvider router={router} /></EditorDraftProvider>
  );
};

export default App;

