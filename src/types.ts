export interface Item {
  id: number;
  value: string;
}

export interface UserState {
  selectedIds: number[];
  sortedIds: number[];
  offset?: number;
}
