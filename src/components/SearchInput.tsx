import React from 'react';
import './SearchInput.css';

interface SearchInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}


const SearchInput: React.FC<SearchInputProps> = ({ value, onChange }) => {
  return (
    <input
      type="text"
      placeholder="Поиск..."
      value={value}
      onChange={onChange}
      className="searchInput"
    />
  );
};

export default SearchInput;