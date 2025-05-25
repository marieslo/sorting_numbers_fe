import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import axios, { type CancelTokenSource } from 'axios';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import throttle from 'lodash/throttle';
import SearchInput from './SearchInput';
import ItemRow from './ItemRow';
import Loader from './Loader';
import { API_URL } from '../api';
import './ItemList.css';

const LIMIT = 20;     
const ITEM_HEIGHT = 30;  // Высота одной строки для определения точки загрузки

// Хук для дебаунса значений 
const useDebounce = <T,>(value: T, delay = 150): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

interface Item {
  id: number;
  value: string;
}

interface UserState {
  selectedIds: number[];
  sortedIds: number[];
  filteredSortedIds: number[];
  offset: number;
  filteredOffset: number;
  scrollTop: number;
  filteredScrollTop: number;
  lastSearch: string;
}

// Утилита для перестановки элементов в массиве
function reorder<T>(list: T[], startIndex: number, endIndex: number): T[] {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

const ItemList: React.FC = () => {
  // Основные состояния для элементов, выбранных id, порядка сортировки, оффсетов и поиска
  const [items, setItems] = useState<Item[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sortedIds, setSortedIds] = useState<number[]>([]);
  const [filteredSortedIds, setFilteredSortedIds] = useState<number[]>([]);
  const [offset, setOffset] = useState(0);
  const [filteredOffset, setFilteredOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [showLoader, setShowLoader] = useState(false);

  // Создаём карту для быстрого доступа к элементам по id
  const itemsMap = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);

  const listRef = useRef<HTMLDivElement>(null);
  const cancelSource = useRef<CancelTokenSource | null>(null);
  const lastRequestId = useRef(0);
  const loaderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Рефы для актуальных значений оффсетов и поиска, чтобы избежать устаревших значений в асинхронных функциях
  const offsetRef = useRef(offset);
  const filteredOffsetRef = useRef(filteredOffset);
  const searchRef = useRef(search);

  const debouncedSearch = useDebounce(search);

  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { filteredOffsetRef.current = filteredOffset; }, [filteredOffset]);
  useEffect(() => { searchRef.current = search; }, [search]);

  // Получить сохранённое состояние пользователя с сервера
  const fetchUserState = useCallback(async (): Promise<UserState> => {
    try {
      const res = await axios.get(`${API_URL}/get-state`);
      return res.data;
    } catch {
      // При ошибке возвращаем пустое состояние по умолчанию
      return {
        selectedIds: [],
        sortedIds: [],
        filteredSortedIds: [],
        offset: 0,
        filteredOffset: 0,
        scrollTop: 0,
        filteredScrollTop: 0,
        lastSearch: '',
      };
    }
  }, []);

  // Сохраняем состояние пользователя на сервере
  const saveUserState = useCallback((state: Partial<UserState>) => {
    axios.post(`${API_URL}/save-state`, state).catch(() => {});
  }, []);

  // Загрузка элементов с сервера с учётом параметров: оффсет, поиск и сортировка
  const loadItems = useCallback(async (start: number, searchTerm: string, useSorted: boolean, limit = LIMIT) => {
    cancelSource.current?.cancel('Cancelled due to new request');
    const requestId = ++lastRequestId.current;
    cancelSource.current = axios.CancelToken.source();

    if (loaderTimer.current) clearTimeout(loaderTimer.current);
    setShowLoader(false);
    loaderTimer.current = setTimeout(() => setShowLoader(true), 1000);

    try {
      const res = await axios.get(`${API_URL}/items`, {
        params: { offset: start, limit, search: searchTerm, useSorted: String(useSorted) },
        cancelToken: cancelSource.current.token,
      });
      if (requestId !== lastRequestId.current) return { items: [], total: 0 };
      return { items: res.data.items, total: res.data.total };
    } catch (e) {
      if (axios.isCancel(e)) return { items: [], total: 0 };
      return { items: [], total: 0 };
    } finally {
      if (loaderTimer.current) clearTimeout(loaderTimer.current);
      loaderTimer.current = null;
      setShowLoader(false);
    }
  }, []);

  // Загрузка элементов по списку id (bulk)
  const loadItemsByIds = useCallback(async (ids: number[]) => {
    if (!ids.length) return [];
    try {
      const res = await axios.post(`${API_URL}/items/bulk`, { ids });
      const map = new Map(res.data.items.map((i: Item) => [i.id, i]));
      return ids.map(id => map.get(id)).filter(Boolean) as Item[];
    } catch {
      return [];
    }
  }, []);

  // Инициализация компонента: загружаем состояние и данные
useEffect(() => {
  (async () => {
    const state = await fetchUserState();

    setSelectedIds(state.selectedIds);
    setSortedIds(state.sortedIds);
    setFilteredSortedIds(state.filteredSortedIds);
    setOffset(state.offset);
    setFilteredOffset(state.filteredOffset);
    setLastSearch(state.lastSearch);

    offsetRef.current = state.offset;
    filteredOffsetRef.current = state.filteredOffset;
    searchRef.current = state.lastSearch;

    const isFiltered = !!state.lastSearch;
    const useSorted = !isFiltered;
    const ids = isFiltered ? state.filteredSortedIds : state.sortedIds;
    const scrollTop = isFiltered ? state.filteredScrollTop : state.scrollTop;

    let loadedItems: Item[] = [];
    if (ids.length) {
      loadedItems = await loadItemsByIds(ids.slice(0, LIMIT));
      if (!isFiltered) setSortedIds(ids);
      else setFilteredSortedIds(ids);
    } else {
      const { items: freshItems } = await loadItems(0, state.lastSearch, useSorted);
      loadedItems = freshItems;
      if (!isFiltered) setSortedIds(freshItems.map((item: { id: any; }) => item.id));
      else setFilteredSortedIds(freshItems.map((item: { id: any; }) => item.id));
    }
    setItems(loadedItems);

    setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = scrollTop;
      setIsInitialized(true);
    }, 0);
  })();
}, [fetchUserState, loadItemsByIds, loadItems]);


  // Обработка изменения поиска с дебаунсом
  useEffect(() => {
    if (!isInitialized || debouncedSearch === lastSearch) return;
    (async () => {
      setLastSearch(debouncedSearch);
      const isFiltered = debouncedSearch !== '';

      if (isFiltered) {
        setFilteredOffset(0);
        filteredOffsetRef.current = 0;
      } else {
        setOffset(0);
        offsetRef.current = 0;
      }

      const { items: newItems } = await loadItems(0, debouncedSearch, !isFiltered);
      setItems(newItems);

      if (isFiltered) {
        setFilteredOffset(newItems.length);
        filteredOffsetRef.current = newItems.length;
        setFilteredSortedIds(newItems.map((item: { id: any; }) => item.id));
      } else {
        setOffset(newItems.length);
        offsetRef.current = newItems.length;
      }
      if (listRef.current) listRef.current.scrollTop = 0;

      saveUserState({
        selectedIds,
        sortedIds,
        filteredSortedIds: isFiltered ? newItems.map((item: { id: any; }) => item.id) : filteredSortedIds,
        offset: offsetRef.current,
        filteredOffset: filteredOffsetRef.current,
        scrollTop: 0,
        filteredScrollTop: 0,
        lastSearch: debouncedSearch,
      });
    })();
  }, [debouncedSearch, lastSearch, isInitialized, loadItems, saveUserState, selectedIds, sortedIds, filteredSortedIds]);

  // Обработка скролла: подгружаем новые элементы, если нужно
  const onScroll = useCallback(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const { scrollTop, scrollHeight, clientHeight } = listEl;

    const isFiltered = debouncedSearch !== '';
    const shouldLoadMore = scrollTop + clientHeight >= scrollHeight - ITEM_HEIGHT;
    if (!shouldLoadMore) return;

    (async () => {
      const offsetVal = isFiltered ? filteredOffsetRef.current : offsetRef.current;
      const { items: newItems } = await loadItems(offsetVal, debouncedSearch, !isFiltered);
      if (!newItems.length) return;

      setItems(prev => [...prev, ...newItems]);

      const newOffset = offsetVal + newItems.length;

      if (isFiltered) {
        setFilteredOffset(newOffset);
        filteredOffsetRef.current = newOffset;
        setFilteredSortedIds(prev => {
          const combined = Array.from(new Set([...prev, ...newItems.map((i: { id: any; }) => i.id)]));
          saveUserState({ filteredSortedIds: combined });
          return combined;
        });
        saveUserState({ filteredOffset: newOffset, filteredScrollTop: scrollTop });
      } else {
        setOffset(newOffset);
        offsetRef.current = newOffset;
        setSortedIds(prev => {
          const combined = Array.from(new Set([...prev, ...newItems.map((i: { id: any; }) => i.id)]));
          saveUserState({ sortedIds: combined });
          return combined;
        });
        saveUserState({ offset: newOffset, scrollTop });
      }
    })();
  }, [debouncedSearch, loadItems, saveUserState]);

  // Throttle для onScroll, чтобы ограничить частоту вызовов
  const throttledOnScroll = useCallback(
    throttle(() => {
      onScroll();
    }, 200),
    [onScroll]
  );

  // Обработка выбора элемента
  const onSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const updated = prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id];
      saveUserState({ selectedIds: updated });
      return updated;
    });
  }, [saveUserState]);

  // Обработка drag and drop перестановки элементов
  const onDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination) return;

    const from = result.source.index;
    const to = result.destination.index;

    const isFiltered = debouncedSearch !== '';
    const currentIds = isFiltered ? filteredSortedIds : sortedIds;
    const setCurrentIds = isFiltered ? setFilteredSortedIds : setSortedIds;

    if (from >= currentIds.length || to >= currentIds.length) return;

    const newIdsOrder = reorder(currentIds, from, to);

    if (isFiltered) {
      // При фильтре могут быть не все элементы загружены, загружаем отсутствующие
      const missingIds = newIdsOrder.filter(id => !itemsMap.has(id));
      if (missingIds.length) {
        const loadedItems = await loadItemsByIds(missingIds);
        setItems(prevItems => {
          const map = new Map(prevItems.map(item => [item.id, item]));
          loadedItems.forEach(item => map.set(item.id, item));
          return newIdsOrder.map(id => map.get(id)!).filter(Boolean);
        });
      } else {
        const reorderedItems = newIdsOrder
          .map(id => itemsMap.get(id))
          .filter((item): item is Item => !!item);
        setItems(reorderedItems);
      }
    } else {
      // Для полного списка переставляем элементы напрямую
      const reorderedItems = newIdsOrder
        .map(id => itemsMap.get(id))
        .filter((item): item is Item => !!item);
      setItems(reorderedItems);
    }

    setCurrentIds(newIdsOrder);
    saveUserState(isFiltered ? { filteredSortedIds: newIdsOrder } : { sortedIds: newIdsOrder });
  }, [debouncedSearch, filteredSortedIds, itemsMap, loadItemsByIds, saveUserState, sortedIds]);

  // Формируем видимый список элементов в текущем порядке и с фильтром
  const visibleItems = useMemo(() => {
    const idsToRender = debouncedSearch ? filteredSortedIds : sortedIds;
    if (!Array.isArray(idsToRender)) return [];
    return idsToRender
      .map(id => itemsMap.get(id))
      .filter((item): item is Item => !!item);
  }, [debouncedSearch, filteredSortedIds, sortedIds, itemsMap]);

  return (
    <div className="itemListContainer">
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search items..."
      />
      <div
        className="listWrapper"
        ref={listRef}
        onScroll={throttledOnScroll}
        style={{ height: '660px', overflowY: 'auto', border: '1px solid #ccc' }}
      >
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="droppable">
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef}>
                {visibleItems.map((item, index) => (
                  <Draggable key={item.id} draggableId={String(item.id)} index={index}>
                    {(providedDraggable) => (
                      <div
                        ref={providedDraggable.innerRef}
                        {...providedDraggable.draggableProps}
                        {...providedDraggable.dragHandleProps}
                      >
                        <ItemRow
                          id={item.id}
                          value={item.value}
                          isSelected={selectedIds.includes(item.id)}
                          onSelect={onSelect}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
                {showLoader && <Loader />}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </div>
  );
};

export default ItemList;