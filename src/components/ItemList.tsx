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
import Loader from './Loader';
import { API_URL } from '../api';
import './ItemList.css';

const LIMIT = 20;           // Кол-во элементов подгружаемых за один запрос
const ITEM_HEIGHT = 30;     // Высота одного элемента списка для логики подгрузки при скролле

// Тип элемента списка
interface Item {
  id: number;
  value: string;
}

// Интерфейс состояния пользователя для сохранения UI-состояния и восстановления
interface UserState {
  selectedIds: number[];
  sortedIds: number[];
  scrollTop: number;
  lastSearch: string;
  offset: number;
}

// Универсальная функция перестановки элементов массива (immutable)
function reorder<T>(list: T[], start: number, end: number): T[] {
  const result = [...list];
  const [removed] = result.splice(start, 1);
  result.splice(end, 0, removed);
  return result;
}

// Кастомный хук для дебаунса значения (задержка обновления) — используется для оптимизации запросов при вводе
const useDebounce = <T,>(value: T, delay = 150): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const ItemList: React.FC = () => {
  const [itemsMap, setItemsMap] = useState(new Map<number, Item>()); // Хранит элементы по id для быстрого доступа
  const [sortedIds, setSortedIds] = useState<number[]>([]);         // Текущий порядок ID для отображения
  const [baseSortedIds, setBaseSortedIds] = useState<number[]>([]); // Исходный порядок (без фильтрации)
  const [selectedIds, setSelectedIds] = useState<number[]>([]);     // Выбранные элементы
  const [search, setSearch] = useState('');                         // Текущий ввод поиска
  const [lastSearch, setLastSearch] = useState('');                 // Последний применённый поиск (для контроля)
  const [offset, setOffset] = useState(0);                          // Смещение для пагинации
  const [isLoadingMore, setIsLoadingMore] = useState(false);        // Флаг подгрузки дополнительных элементов
  const [isInitialized, setIsInitialized] = useState(false);        // Флаг загрузки первоначального состояния

  // Реф для контейнера списка — нужен для контроля скролла
  const listRef = useRef<HTMLDivElement>(null);

  // Сохраняем scrollTop для восстановления скролла после рендера
  const savedScrollTop = useRef(0);

  // Для отмены предыдущих запросов (например, при быстром вводе поиска)
  const cancelSource = useRef<CancelTokenSource | null>(null);

  // Уникальный инкремент для идентификации актуального запроса (чтобы избежать race conditions)
  const lastRequestId = useRef(0);

  // Задержка для поиска — чтобы не делать запрос при каждом вводе символа
  const debouncedSearch = useDebounce(search);

  // Получаем сохранённое состояние пользователя с сервера
  const fetchUserState = async (): Promise<UserState> => {
    try {
      const res = await axios.get(`${API_URL}/get-state`);
      return res.data;
    } catch {
      // Возвращаем дефолт, если ошибка (например, первый заход)
      return { selectedIds: [], sortedIds: [], scrollTop: 0, lastSearch: '', offset: 0 };
    }
  };

  // Сохраняем состояние пользователя на сервере, игнорируем ошибки (fire-and-forget)
  const saveUserState = (state: Partial<UserState>) => {
    axios.post(`${API_URL}/save-state`, state).catch(() => {});
  };

  // Загружаем элементы с сервера с пагинацией и поиском
  const loadItems = async (start: number, searchTerm: string, limit = LIMIT): Promise<Item[]> => {
    // Отменяем предыдущий запрос, если есть
    cancelSource.current?.cancel();
    cancelSource.current = axios.CancelToken.source();

    // Обновляем id текущего запроса для отслеживания актуальности данных
    const requestId = ++lastRequestId.current;

    setIsLoadingMore(true);

    try {
      const res = await axios.get(`${API_URL}/items`, {
        params: { offset: start, limit, search: searchTerm },
        cancelToken: cancelSource.current.token,
      });

      // Проверяем, что это последний запрос — если нет, игнорируем результат
      if (requestId !== lastRequestId.current) return [];

      return res.data.items;
    } catch {
      return [];
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Инициализация компонента — загрузка пользовательского состояния и элементов
  useEffect(() => {
    (async () => {
      const state = await fetchUserState();

      // Восстанавливаем UI-состояние
      setSelectedIds(state.selectedIds);
      setSortedIds(state.sortedIds);
      setBaseSortedIds(state.sortedIds);
      setSearch(state.lastSearch);
      setLastSearch(state.lastSearch);
      setOffset(state.offset);
      savedScrollTop.current = state.scrollTop;

      let loadedItems: Item[] = [];

      // Если есть сохранённый порядок, пытаемся загрузить по ID
      if (state.sortedIds.length) {
        try {
          const res = await axios.post(`${API_URL}/items/bulk`, { ids: state.sortedIds });
          loadedItems = res.data.items;
        } catch {
          // fallback: загружаем элементы по offset, если bulk-запрос не удался
          loadedItems = await loadItems(0, state.lastSearch, state.offset || LIMIT);
        }
      } else {
        // Иначе загружаем первые элементы без фильтра
        loadedItems = await loadItems(0, '', LIMIT);
        const ids = loadedItems.map(i => i.id);
        setSortedIds(ids);
        setBaseSortedIds(ids);
      }

      // Сохраняем элементы в Map для быстрого доступа по id
      setItemsMap(new Map(loadedItems.map(i => [i.id, i])));

      setIsInitialized(true);

      // Восстанавливаем scrollTop после рендера
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = savedScrollTop.current;
      });
    })();
  }, []);

  // Эффект отслеживает изменения в поиске, реализует логику фильтрации и сброса поиска
  useEffect(() => {
    if (!isInitialized) return;

    // Если пользователь очистил поиск — восстанавливаем базовый список
    if (debouncedSearch === '' && lastSearch !== '') {
      (async () => {
        setSortedIds(baseSortedIds);
        setLastSearch('');
        saveUserState({ sortedIds: baseSortedIds, lastSearch: '' });

        try {
          const res = await axios.post(`${API_URL}/items/bulk`, { ids: baseSortedIds });
          const restoredItems = res.data.items as Item[];
          const newMap = new Map(restoredItems.map(item => [item.id, item]));
          setItemsMap(newMap);
        } catch {
          // При ошибке сбрасываем список
          setItemsMap(new Map());
        }

        // Скроллим вверх при сбросе поиска
        if (listRef.current) listRef.current.scrollTop = 0;
      })();

      return;
    }

    // При изменении поиска — делаем новый запрос с фильтром
    if (debouncedSearch !== '' && debouncedSearch !== lastSearch) {
      (async () => {
        setLastSearch(debouncedSearch);
        setOffset(0);

        // Загружаем новые элементы по поиску
        const newItems = await loadItems(0, debouncedSearch);
        const newMap = new Map(newItems.map(i => [i.id, i]));
        setItemsMap(newMap);

        const newIds = newItems.map(i => i.id);
        setSortedIds(newIds);

        // Сохраняем состояние пользователя
        saveUserState({ sortedIds: newIds, lastSearch: debouncedSearch, offset: newItems.length, scrollTop: 0 });

        // Скроллим в начало списка
        if (listRef.current) listRef.current.scrollTop = 0;
      })();
    }
  }, [debouncedSearch, isInitialized, lastSearch, baseSortedIds]);

  // Обработчик скролла — для бесконечной подгрузки элементов и сохранения scrollTop
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;

    // Проверяем, нужно ли подгрузить еще элементы — когда пользователь почти долистал до конца списка
    const shouldLoad = scrollTop + clientHeight >= scrollHeight - ITEM_HEIGHT;

    if (shouldLoad && !isLoadingMore) {
      // Асинхронно подгружаем элементы и объединяем их с текущими
      const loadMore = async () => {
        const newItems = await loadItems(offset, search);
        const newMap = new Map(itemsMap);
        newItems.forEach(item => newMap.set(item.id, item));
        setItemsMap(newMap);

        const newIds = newItems.map(i => i.id);
        setSortedIds(prev => {
          // Убираем дубликаты с помощью Set, т.к. возможно элементы могут повториться
          const combined = [...prev, ...newIds];
          return Array.from(new Set(combined));
        });

        // Увеличиваем offset для следующей подгрузки
        setOffset(prev => prev + newItems.length);
      };
      loadMore();
    }

    // Сохраняем позицию скролла в пользовательском состоянии
    saveUserState({ scrollTop });
  }, [isLoadingMore, offset, itemsMap, search]);

  // Используем throttle, чтобы ограничить частоту вызовов onScroll (оптимизация производительности)
  const throttledScroll = useMemo(() => throttle(onScroll, 200), [onScroll]);

  // Обработчик выбора элемента — добавляем/удаляем из выбранных
  const onSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const updated = prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id];
      saveUserState({ selectedIds: updated });
      return updated;
    });
  }, []);

  // Обработчик окончания drag-n-drop — переставляем элементы и сохраняем состояние
  const onDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;

    // Вычисляем новый порядок элементов после перестановки
    const newSorted = reorder(sortedIds, result.source.index, result.destination.index);

    // Обновляем состояния с новым порядком
    setSortedIds(newSorted);
    setBaseSortedIds(newSorted);

    // Сохраняем пользовательское состояние для восстановления порядка
    saveUserState({ sortedIds: newSorted });
  }, [sortedIds]);

  // Формируем массив видимых элементов по текущему порядку sortedIds
  const visibleItems = useMemo(() => {
    return sortedIds.map(id => itemsMap.get(id)).filter(Boolean) as Item[];
  }, [sortedIds, itemsMap]);

  return (
    <div className="itemListContainer">
      <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} />
      <div
        className="listWrapper"
        ref={listRef}
        onScroll={throttledScroll}
        style={{ height: '660px', overflowY: 'auto', border: '1px solid #ccc' }}
      >
        {!isInitialized ? (
          <Loader />
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
          <div style={{ textAlign: 'center', padding: '10px', fontSize: '12px' }}>
            Загрузка...
          </div>
        )}
      </div>
    </div>
  );
};

export default ItemList;