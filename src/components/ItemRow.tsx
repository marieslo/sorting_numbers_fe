import React from 'react';
import type { DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd';
import './ItemRow.css';

interface ItemRowProps {
  id: number;
  value: string;
  isSelected: boolean;
  onSelect: (id: number) => void;
  provided?: DraggableProvided;
  snapshot?: DraggableStateSnapshot;
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
    isSelected && 'selected',
    snapshot?.isDragging && 'dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={provided?.innerRef}
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      className={className}
      style={{
        ...provided?.draggableProps?.style,
        userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onSelect(id)}
      />
      {value}
    </div>
  );
};

export default React.memo(ItemRow);