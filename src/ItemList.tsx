import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import type { Item, UserState } from '../src/types';
import InfiniteScroll from 'react-infinite-scroll-component';
import {
  DragDropContext,
  Droppable,
  Draggable,
} from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';

import SearchInput from './SearchInput';
import ItemRow from './ItemRow';
import Loader from './Loader';
import { API_URL } from '../src/api/api';

const LIMIT = 20;

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

const ItemList = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sortedIds, setSortedIds] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [loading, setLoading] = useState(false);

  const debouncedSearch = useDebounce(search, 300);
  const isLoadingRef = useRef(false);

  const fetchUserState = useCallback(async (): Promise<UserState> => {
    try {
      const response = await axios.get<UserState>(`${API_URL}/get-state`);
      return response.data;
    } catch (e) {
      console.error('Ошибка загрузки состояния:', e);
      return { selectedIds: [], sortedIds: [], offset: 0 };
    }
  }, []);

  const saveUserState = useCallback((state: UserState) => {
    axios.post(`${API_URL}/save-state`, state).catch(console.error);
  }, []);

  const loadItems = useCallback(
    async (start: number, searchTerm: string, useSorted = false) => {
      if (isLoadingRef.current) return { items: [], total: 0 };
      isLoadingRef.current = true;
      setLoading(true);

      try {
        const response = await axios.get<{ items: Item[]; total: number }>(`${API_URL}/items`, {
          params: { offset: start, limit: LIMIT, search: searchTerm, useSorted: useSorted.toString() },
        });

        return { items: response.data.items, total: response.data.total };
      } catch (err) {
        console.error('Ошибка при загрузке элементов:', err);
        return { items: [], total: 0 };
      } finally {
        isLoadingRef.current = false;
        setLoading(false);
      }
    },
    []
  );

  // Инициализация: загрузка состояния и первых элементов
  useEffect(() => {
    (async () => {
      const state = await fetchUserState();
      setSelectedIds(state.selectedIds || []);
      setSortedIds(state.sortedIds || []);
      const savedOffset = state.offset || 0;

      const { items: firstBatch, total: totalCount } = await loadItems(0, '', savedOffset === 0 ? false : true);
      setItems(firstBatch);
      setOffset(firstBatch.length);
      setHasMore(firstBatch.length < totalCount);
      setTotal(totalCount);

      // Если сохранён оффсет больше LIMIT — подгружаем остальные
      if (savedOffset > LIMIT) {
        let allItems = firstBatch;
        for (let start = LIMIT; start < savedOffset; start += LIMIT) {
          const { items: batch } = await loadItems(start, '', true);
          allItems = [...allItems, ...batch];
        }
        setItems(allItems);
        setOffset(allItems.length);
        setHasMore(allItems.length < totalCount);
      }
      setIsInitialized(true);
    })();
  }, [fetchUserState, loadItems]);

  // Обработка изменения поискового запроса (debounced)
  useEffect(() => {
    if (!isInitialized) return;

    (async () => {
      setOffset(0);
      setHasMore(true);
      const useSorted = debouncedSearch === '' && sortedIds.length > 0;
      const { items: newItems, total: totalCount } = await loadItems(0, debouncedSearch, useSorted);

      setItems(newItems);
      setTotal(totalCount);
      setOffset(newItems.length);
      setHasMore(newItems.length < totalCount);
    })();
  }, [debouncedSearch, isInitialized, loadItems, sortedIds]);

  // Сохраняем состояние при изменениях
  useEffect(() => {
    if (!isInitialized) return;
    saveUserState({ selectedIds, sortedIds, offset });
  }, [selectedIds, sortedIds, offset, saveUserState, isInitialized]);

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }, []);

  // Загрузка следующей порции элементов при скролле
  const loadMore = useCallback(async () => {
    if (isLoadingRef.current || !hasMore) return;

    const useSorted = debouncedSearch === '' && sortedIds.length > 0;

    const { items: newItems } = await loadItems(offset, debouncedSearch, useSorted);

    setItems((prev) => {
      const existingIds = new Set(prev.map((item) => item.id));
      const filteredNewItems = newItems.filter((item) => !existingIds.has(item.id));
      return [...prev, ...filteredNewItems];
    });

    setOffset((prev) => prev + newItems.length);
    setHasMore(offset + newItems.length < total);
  }, [loadItems, offset, debouncedSearch, sortedIds, hasMore, total]);

  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      if (debouncedSearch) return; // запретить сортировку при поиске

      const newItems = Array.from(items);
      const [removed] = newItems.splice(result.source.index, 1);
      newItems.splice(result.destination.index, 0, removed);

      setItems(newItems);

      const newSortedIds = newItems.map((item) => item.id);
      setSortedIds(newSortedIds);

      saveUserState({ selectedIds, sortedIds: newSortedIds, offset });
    },
    [items, saveUserState, selectedIds, offset, debouncedSearch]
  );

  return (
    <div>
      <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} />
      <div id="scrollableDiv" style={{ height: 650, width: '420px', overflow: 'auto' }}>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="list">
            {(provided) => (
              <InfiniteScroll
                dataLength={items.length}
                next={loadMore}
                hasMore={hasMore}
                loader={<Loader />}
                scrollableTarget="scrollableDiv"
                scrollThreshold={0.8}
                style={{ overflow: 'visible' }}
              >
                <ul {...provided.droppableProps} ref={provided.innerRef} className="item-list">
                  {items.map((item, index) => (
                    <Draggable key={item.id} draggableId={item.id.toString()} index={index}>
                      {(provided, snapshot) => (
                        <ItemRow
                          id={item.id}
                          value={item.value}
                          isSelected={selectedIds.includes(item.id)}
                          onToggleSelect={handleToggleSelect}
                          provided={provided}
                          snapshot={snapshot}
                        />
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </ul>
                {loading && items.length > 0 && <Loader />}
              </InfiniteScroll>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </div>
  );
};

export default ItemList;