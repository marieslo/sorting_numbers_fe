import React, { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import type { Item } from '../src/types';
import { API_URL } from '../src/api/api';

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

const fetchItems = async (search = '', offset = 0, limit = 20, useSorted = false) => {
  const response = await axios.get<{ items: Item[]; total: number }>(`${API_URL}/items`, {
    params: { search, offset, limit, ...(useSorted ? { useSorted: 'true' } : {}) },
  });
  return response.data;
};

const fetchUserState = async () => {
  const response = await axios.get<{ selectedIds: number[]; sortedIds: number[]; offset: number }>(
    `${API_URL}/get-state`
  );
  return response.data;
};

const saveUserState = async (state: { selectedIds: number[]; sortedIds: number[]; offset: number }) => {
  await axios.post(`${API_URL}/save-state`, state);
};

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

  const loadMoreItems = async (
    start: number,
    searchTerm: string,
    replace = false,
    useSorted = false,
    sortedIdsParam: number[] = sortedIds
  ) => {
    setLoading(true);
    try {
      const data = await fetchItems(searchTerm, start, LIMIT, useSorted);
      let newItems = replace ? data.items : [...items, ...data.items];

      if (useSorted && sortedIdsParam.length > 0) {
        const map = new Map(newItems.map((item) => [item.id, item]));
        const ordered = sortedIdsParam.map((id) => map.get(id)).filter(Boolean) as Item[];
        const sortedSet = new Set(sortedIdsParam);
        const rest = newItems.filter((item) => !sortedSet.has(item.id));
        newItems = [...ordered, ...rest];
      }

      setItems(newItems);
      setTotal(data.total);
      setOffset(start + LIMIT);
      saveUserState({ selectedIds, sortedIds, offset: start + LIMIT });
    } catch (err) {
      console.error('Ошибка при загрузке элементов:', err);
    }
    setLoading(false);
  };

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || loading) return;

    if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
      if (offset < total) {
        loadMoreItems(offset, search, false, true);
      }
    }
  }, [offset, total, search, loading, sortedIds]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const updated = prev.includes(id)
        ? prev.filter((i) => i !== id)
        : [...prev, id];
      saveUserState({ selectedIds: updated, sortedIds, offset });
      return updated;
    });
  };

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