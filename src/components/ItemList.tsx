import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
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
import { API_URL } from '../api';
import './ItemList.css';

const LIMIT = 20;           // Количество элементов подгружаемых за один запрос
const ITEM_HEIGHT = 30;     // Высота одного элемента списка (для вычисления подгрузки)

interface Item {
  id: number;
  value: string;
}

interface UserState {
  selectedIds: number[];
  sortedIds: number[];
  scrollTop: number;
  lastSearch: string;
  offset: number;
}

/**
 * Утилита для перестановки элементов массива при drag-and-drop.
 * Возвращает новый массив с элементами в новом порядке.
 */
function reorder<T>(list: T[], start: number, end: number): T[] {
  const result = [...list];
  const [removed] = result.splice(start, 1);
  result.splice(end, 0, removed);
  return result;
}

/**
 * Хук для дебаунса значения с задержкой.
 * Используется для оптимизации частоты вызова при вводе текста (например, поиска).
 */
const useDebounce = <T,>(value: T, delay = 150): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

const ItemList: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);               // Загруженные элементы
  const [selectedIds, setSelectedIds] = useState<number[]>([]); // Выбранные элементы
  const [sortedIds, setSortedIds] = useState<number[]>([]);     // Порядок элементов (id)
  const [offset, setOffset] = useState(0);                      // Смещение для пагинации
  const [search, setSearch] = useState('');                     // Введённый поисковый запрос
  const [lastSearch, setLastSearch] = useState('');             // Последний применённый поисковый запрос
  const [isInitialized, setIsInitialized] = useState(false);    // Флаг завершения начальной загрузки
  const [isLoadingMore, setIsLoadingMore] = useState(false);    // Флаг загрузки при подгрузке

  const listRef = useRef<HTMLDivElement>(null);                 // Реф на контейнер списка
  const cancelSource = useRef<CancelTokenSource | null>(null);  // Источник отмены axios-запроса
  const lastRequestId = useRef(0);                               // Идентификатор последнего запроса для предотвращения race conditions

  // Рефы для актуальных значений offset и search внутри колбеков
  const offsetRef = useRef(offset);
  const searchRef = useRef(search);
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { searchRef.current = search; }, [search]);

  // Быстрый доступ к элементам по id
  const itemsMap = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  // Дебаунсим значение поиска для снижения количества запросов
  const debouncedSearch = useDebounce(search);

  // Сохраняем scrollTop в ref, чтобы потом применить после рендера
  const savedScrollTop = useRef(0);
  // Флаг, чтобы скролл восстанавливался один раз после загрузки
  const [scrollRestored, setScrollRestored] = useState(false);

  /**
   * Запрос состояния пользователя с сервера
   * (выбранные элементы, порядок сортировки, позиция скролла и т.п.)
   */
  const fetchUserState = useCallback(async (): Promise<UserState> => {
    try {
      const res = await axios.get(`${API_URL}/get-state`);
      return res.data;
    } catch {
      // При ошибке возвращаем дефолтное состояние
      return {
        selectedIds: [],
        sortedIds: [],
        scrollTop: 0,
        lastSearch: '',
        offset: 0,
      };
    }
  }, []);

  /**
   * Сохраняем состояние пользователя на сервере:
   * выбранные элементы, порядок, позиция скролла, поисковый запрос, смещение и т.п.
   */
  const saveUserState = useCallback((state: Partial<UserState>) => {
    axios.post(`${API_URL}/save-state`, state).catch(() => {
      // Игнорируем ошибки сохранения состояния
    });
  }, []);

  /**
   * Загрузка элементов с сервера с поддержкой отмены предыдущего запроса
   * и индикатора загрузки, если загрузка долгая.
   */
  const loadItems = useCallback(async (start: number, searchTerm: string, limit = LIMIT) => {
    cancelSource.current?.cancel();                  // Отменяем предыдущий запрос
    cancelSource.current = axios.CancelToken.source();
    const requestId = ++lastRequestId.current;

    setIsLoadingMore(false);
    const loaderTimeout = setTimeout(() => setIsLoadingMore(true), 800);

    try {
      const res = await axios.get(`${API_URL}/items`, {
        params: { offset: start, limit, search: searchTerm },
        cancelToken: cancelSource.current.token,
      });
      if (requestId !== lastRequestId.current) return { items: [], total: 0 }; // Игнорируем устаревший запрос
      return res.data;
    } catch {
      return { items: [], total: 0 };
    } finally {
      clearTimeout(loaderTimeout);
      setIsLoadingMore(false);
    }
  }, []);

  /**
   * Эффект инициализации компонента:
   *  - Загружаем состояние пользователя
   *  - Восстанавливаем выбранные элементы, порядок, поисковый запрос, смещение
   *  - Загружаем элементы (bulk-запросом или с offset)
   *  - Сохраняем scrollTop в ref для последующего восстановления
   */
useEffect(() => {
  (async () => {
    const state = await fetchUserState();

    setSelectedIds(state.selectedIds);
    setLastSearch(state.lastSearch);
    setSearch(state.lastSearch);
    setOffset(state.offset);

    savedScrollTop.current = state.scrollTop || 0;
    setScrollRestored(false);

    let loadedItems: Item[] = [];

    if (state.lastSearch) {
      // Если есть поисковый запрос — грузим именно по нему
      const { items: searchItems } = await loadItems(0, state.lastSearch, state.offset || LIMIT);
      loadedItems = searchItems;
      setSortedIds(searchItems.map((i: { id: any; }) => i.id));
    } else if (state.sortedIds.length) {
      try {
        const res = await axios.post(`${API_URL}/items/bulk`, { ids: state.sortedIds });
        loadedItems = res.data.items;
        setSortedIds(state.sortedIds);
      } catch {
        const { items: freshItems } = await loadItems(0, '', state.offset || LIMIT);
        loadedItems = freshItems;
        setSortedIds(freshItems.map((i: { id: any; }) => i.id));
      }
    } else {
      const { items: freshItems } = await loadItems(0, '', state.offset || LIMIT);
      loadedItems = freshItems;
      setSortedIds(freshItems.map((i: { id: any; }) => i.id));
    }

    setItems(loadedItems);
    setIsInitialized(true);
  })();
}, [fetchUserState, loadItems]);


  /**
   * Эффект для восстановления позиции скролла.
   * Выполняется после того, как данные (items) загружены и компонент инициализирован.
   * Устанавливает scrollTop один раз, предотвращая «скачки» скролла.
   */
  useEffect(() => {
    if (isInitialized && items.length && !scrollRestored) {
      if (listRef.current) {
        listRef.current.scrollTop = savedScrollTop.current;
      }
      setScrollRestored(true);
    }
  }, [isInitialized, items, scrollRestored]);

  /**
   * Эффект для обработки изменения поискового запроса (с дебаунсом).
   * При изменении поиска:
   *  - Сбрасываем offset
   *  - Загружаем новые элементы
   *  - Сбрасываем скролл в начало
   *  - Сохраняем состояние пользователя
   */
  useEffect(() => {
    if (!isInitialized || debouncedSearch === lastSearch) return;

    (async () => {
      setLastSearch(debouncedSearch);
      setOffset(0);

      const { items: newItems } = await loadItems(0, debouncedSearch);
      setItems(newItems);

      const newIds = newItems.map((i: { id: any; }) => i.id);
      setSortedIds(newIds);

      // Сбрасываем скролл в начало при новом поиске
      if (listRef.current) listRef.current.scrollTop = 0;

      saveUserState({
        selectedIds,
        sortedIds: newIds,
        offset: newItems.length,
        scrollTop: 0,
        lastSearch: debouncedSearch,
      });

      setScrollRestored(true);
    })();
  }, [debouncedSearch, isInitialized, lastSearch, loadItems, saveUserState, selectedIds]);

  /**
   * Обработчик скролла для подгрузки новых элементов при достижении низа списка.
   * Также сохраняет позицию скролла в состоянии пользователя.
   */
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const shouldLoad = scrollTop + clientHeight >= scrollHeight - ITEM_HEIGHT;

    if (shouldLoad && !isLoadingMore) {
      const currentOffset = offsetRef.current;
      const currentSearch = searchRef.current;

      setIsLoadingMore(true);
      loadItems(currentOffset, currentSearch).then(({ items: newItems }) => {
        if (newItems.length === 0) {
          setIsLoadingMore(false);
          return;
        }

        setItems(prev => [...prev, ...newItems]);
        setOffset(prev => prev + newItems.length);

        const newIds = newItems.map((i: { id: any; }) => i.id);
        setSortedIds(prev => Array.from(new Set([...prev, ...newIds])));
        setIsLoadingMore(false);
      });
    }

    // Сохраняем текущий scrollTop
    saveUserState({
      scrollTop,
    });
  }, [loadItems, saveUserState, isLoadingMore]);

  // throttle для onScroll, чтобы не вызывать слишком часто
  const throttledScroll = useMemo(() => throttle(onScroll, 200), [onScroll]);

  /**
   * Обработчик выбора/снятия выбора элемента списка.
   * Обновляет состояние выбранных и сохраняет на сервер.
   */
  const onSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const updated = prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id];
      saveUserState({ selectedIds: updated });
      return updated;
    });
  }, [saveUserState]);

  /**
   * Обработчик окончания drag-and-drop перестановки.
   * Обновляет порядок элементов и сохраняет состояние.
   */
  const onDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination) return;

    const from = result.source.index;
    const to = result.destination.index;

    const newIds = reorder(sortedIds, from, to);

    const updatedItems = newIds.map(id => itemsMap.get(id)).filter(Boolean) as Item[];
    setItems(updatedItems);
    setSortedIds(newIds);

    saveUserState({ sortedIds: newIds });
  }, [sortedIds, itemsMap, saveUserState]);

  /**
   * Формируем массив элементов для отображения по текущему порядку sortedIds.
   */
  const visibleItems = useMemo(() => {
    return sortedIds.map(id => itemsMap.get(id)).filter(Boolean) as Item[];
  }, [sortedIds, itemsMap]);



  return (
    <div className="itemListContainer">
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div
        className="listWrapper"
        ref={listRef}
        onScroll={throttledScroll}
        style={{ height: '660px', overflowY: 'auto', border: '1px solid #ccc' }}
      >

        {!isInitialized ? (
          <div
            style={{
              height: '100%',
              textAlign: 'center',
              paddingTop: '250px',
              fontSize: '12px',
              fontWeight: 'bold',
              color: 'grey',
            }}
          >
            Loading...
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="list">
              {(droppableProvided) => (
                <div
                  {...droppableProvided.droppableProps}
                  ref={droppableProvided.innerRef}
                >
                  {visibleItems.map((item, index) => (
                   <Draggable key={item.id} draggableId={String(item.id)} index={index}>
                      {(provided, snapshot) => (
                        <ItemRow
                          id={item.id}
                          value={item.value}
                          isSelected={selectedIds.includes(item.id)}
                          onSelect={onSelect}
                          provided={provided}
                          snapshot={snapshot}
                        />
                      )}
                    </Draggable>
                  ))}
                  {droppableProvided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}

        {isLoadingMore && (
          <div style={{ textAlign: 'center', padding: '10px', fontSize: '12px' }}>Загрузка...</div>
        )}
      </div>
    </div>
  );
};

export default ItemList;