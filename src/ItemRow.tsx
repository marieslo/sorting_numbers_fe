import React from 'react';
import type { DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd';
import './ItemRow.css';

interface ItemRowProps {
  id: number;
  value: string;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  provided: DraggableProvided;
  snapshot: DraggableStateSnapshot;
}

const ItemRow: React.FC<ItemRowProps> = ({
  id,
  value,
  isSelected,
  onToggleSelect,
  provided,
  snapshot,
}) => {
  return (
    <li
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className={`itemRow${isSelected ? ' selected' : ''}${snapshot.isDragging ? ' dragging' : ''}`}
      style={provided.draggableProps.style}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggleSelect(id)}
      />
      {value}
    </li>
  );
};

export default ItemRow;