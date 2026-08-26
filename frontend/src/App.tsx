import { BrowserRouter as Router } from 'react-router-dom';
import { Navigation, AppRoutes } from './router/Routes';
import './App.css';

// 主应用包装器
const App: React.FC = () => {
  return (
    <Router>
      <div className="app">
        <Navigation />
        <AppRoutes />
      </div>
    </Router>
  );
};

export default App;
