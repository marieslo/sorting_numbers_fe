import axios from 'axios';
import type { Item, UserState } from '../types';

const API_URL = 'https://sorting-numbers-be.onrender.com';

export const fetchItems = async (search = '', offset = 0, limit = 20) => {
  const response = await axios.get<{ items: Item[]; total: number }>(`${API_URL}/items`, {
    params: { search, offset, limit },
  });
  return response.data;
};

export const fetchUserState = async () => {
  const response = await axios.get<UserState>(`${API_URL}/get-state`);
  return response.data;
};

export const saveUserState = async (state: UserState) => {
  await axios.post(`${API_URL}/save-state`, state);
};
