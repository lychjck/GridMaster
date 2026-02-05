import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8080/api',
    timeout: 10000,
});

// dateStr optional: "YYYY-MM-DD"
export const getKlines = async (dateStr = '') => {
    const url = dateStr ? `/klines?date=${dateStr}` : '/klines';
    const response = await api.get(url);
    return response.data.data;
};

export const getDailyKlines = async (dateStr = '') => {
    const url = dateStr ? `/klines/daily?date=${dateStr}` : '/klines/daily';
    const response = await api.get(url);
    return response.data.data;
};

export const getAvailableDates = async () => {
    const response = await api.get('/dates');
    return response.data.data;
};

export const runSimulation = async (config) => {
    const response = await api.post('/simulate', config);
    return response.data;
};

export default api;
