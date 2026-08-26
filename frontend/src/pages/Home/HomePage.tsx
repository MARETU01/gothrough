import React from 'react';
import './HomePage.css';

const HomePage: React.FC = () => {
  return (
    <div className="home-page">
      <header className="home-header">
        <h1>欢迎来到我们的应用</h1>
      </header>
      
      <main className="home-main">
        <div className="welcome-section">
          <h2>欢迎使用</h2>
          <p>我们致力于为您提供最佳的用户体验</p>
        </div>
        
        <div className="features-section">
          <div className="feature-card">
            <h3>功能一</h3>
            <p>这是第一个功能描述</p>
          </div>
          <div className="feature-card">
            <h3>功能二</h3>
            <p>这是第二个功能描述</p>
          </div>
          <div className="feature-card">
            <h3>功能三</h3>
            <p>这是第三个功能描述</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default HomePage;