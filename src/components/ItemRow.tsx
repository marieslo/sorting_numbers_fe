import React from 'react';
import type { DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd';
import './ItemRow.css';

interface ItemRowProps {
  id: number;
  value: string;
  isSelected: boolean;
  onSelect: (id: number) => void;
  provided: DraggableProvided; 
  snapshot: DraggableStateSnapshot;
}

const ItemRow: React.FC<ItemRowProps> = ({
  id,
  value,
  isSelected,
  onSelect,
  provided,
  snapshot,
}) => {
  const className = [
    'itemRow',
    isSelected ? 'selected' : '',
    snapshot.isDragging ? 'dragging' : '',
  ].filter(Boolean).join(' ');

  // Извлекаем style из draggableProps для корректного применения стилей drag'n'drop
  const { style } = provided.draggableProps;

  // Обработчик клика на весь элемент — выбирает/снимает выбор
  const handleClick = () => {
    onSelect(id);
  };

  // Обработчик для чекбокса: предотвращаем всплытие, чтобы клик не попадал на родителя
  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onSelect(id);
  };

  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className={className}
      style={{ ...style, userSelect: 'none' }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Item: ${value}, ${isSelected ? 'selected' : 'not selected'}`}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onSelect(id);
        }
      }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={handleCheckboxChange}
        onClick={(e) => e.stopPropagation()} // предотвращаем двойной клик на чекбокс
        tabIndex={-1} // исключаем из tab-порядка (весь элемент интерактивен)
      />
      <span>{value}</span>
    </div>
  );
};

export default React.memo(ItemRow);