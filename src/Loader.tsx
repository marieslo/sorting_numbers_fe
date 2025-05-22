import React from 'react';
import './Loader.css';

const Loader: React.FC = () => {
  return (
    <div className="loader-container">
      <div className="loader-spinner" />
    </div>
  );
};

export default Loader;