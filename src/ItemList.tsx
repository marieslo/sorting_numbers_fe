import React, { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import type { Item } from '../src/types';
import { fetchUserState, saveUserState } from '../src/api/api';

import {
  DragDropContext,
  Droppable,
  Draggable,
} from '@hello-pangea/dnd';

import type { DropResult } from '@hello-pangea/dnd';

import SearchInput from './SearchInput';
import ItemRow from './ItemRow';
import Loader from './Loader';
import './ItemList.css';

const LIMIT = 20;
const API_URL = 'http://localhost:4000';

const ItemList = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sortedIds, setSortedIds] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const listRef = useRef<HTMLUListElement>(null);

  // Загрузка состояния с сервера и начальная загрузка элементов
  useEffect(() => {
    const loadStateAndItems = async () => {
      setLoading(true);
      const state = await fetchUserState();
      setSelectedIds(state.selectedIds || []);
      setSortedIds(state.sortedIds || []);
      setOffset(state.offset || 0);

      await loadMoreItems(state.offset || 0, search, true, true, state.sortedIds || []);
      setLoading(false);
    };
    loadStateAndItems();
  }, []);

  // sortedIdsParam — явно передаем порядок сортировки
  const loadMoreItems = async (
    start: number,
    searchTerm: string,
    replace = false,
    useSorted = false,
    sortedIdsParam: number[] = sortedIds
  ) => {
    setLoading(true);
    try {
      const params = {
        search: searchTerm,
        offset: start,
        limit: LIMIT,
        ...(useSorted ? { useSorted: 'true' } : {}),
      };

      const response = await axios.get(`${API_URL}/items`, { params });
      const data = response.data;

      // Если replace, начинаем с новой группы, иначе - дополняем
      let newItems = replace ? data.items : [...items, ...data.items];

      if (useSorted && sortedIdsParam.length > 0) {
        // Сортируем newItems согласно sortedIdsParam (оставшиеся элементы - в конце)
        const map = new Map(newItems.map((item: { id: any }) => [item.id, item]));
        const ordered = sortedIdsParam
          .map((id) => map.get(id))
          .filter(Boolean) as Item[];
        const sortedSet = new Set(sortedIdsParam);
        const rest = newItems.filter((item: { id: number }) => !sortedSet.has(item.id));
        newItems = [...ordered, ...rest];
      }
      setItems(newItems);
      setTotal(data.total);
      setOffset(start + LIMIT);
      // Сохраняем состояние с обновлённым offset
      saveUserState({ selectedIds, sortedIds, offset: start + LIMIT });
    } catch (err) {
      console.error('Ошибка при загрузке элементов:', err);
    }
    setLoading(false);
  };

  // Скролл: подгружаем следующую порцию при достижении низа списка
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || loading) return;

    if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
      if (offset < total) {
        loadMoreItems(offset, search, false, true);
      }
    }
  }, [offset, total, search, loading, sortedIds]);

  // Вешаем слушатель скролла на ul
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  // Выбор элемента - сохраняем на сервере вместе с сортировкой и offset
  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const updated = prev.includes(id)
        ? prev.filter((i) => i !== id)
        : [...prev, id];
      saveUserState({ selectedIds: updated, sortedIds, offset });
      return updated;
    });
  };

  // Drag and drop - меняем порядок, сохраняем на сервере вместе с offset
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const newItems = Array.from(items);
    const [removed] = newItems.splice(result.source.index, 1);
    newItems.splice(result.destination.index, 0, removed);

    setItems(newItems);

    const newOrder = newItems.map((item) => item.id);
    setSortedIds(newOrder);
    saveUserState({ selectedIds, sortedIds: newOrder, offset });
  };

  // При изменении поиска сбрасываем оффсет и загружаем результаты с сортировкой
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearch(val);
    setOffset(0);
    loadMoreItems(0, val, true, true);

    saveUserState({ selectedIds, sortedIds, offset: 0 });
  };

  return (
    <div>
      <SearchInput value={search} onChange={handleSearchChange} />
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="list">
          {(provided) => (
            <ul
              {...provided.droppableProps}
              ref={(node) => {
                provided.innerRef(node);
                listRef.current = node;
              }}
              className="item-list"
            >
              {items.map((item, idx) => {
                const isSelected = selectedIds.includes(item.id);
                return (
                  <Draggable
                    key={item.id}
                    draggableId={item.id.toString()}
                    index={idx}
                  >
                    {(provided, snapshot) => (
                      <ItemRow
                        id={item.id}
                        value={item.value}
                        isSelected={isSelected}
                        onToggleSelect={handleToggleSelect}
                        provided={provided}
                        snapshot={snapshot}
                      />
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
              {loading && <Loader />}
            </ul>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
};

export default ItemList;