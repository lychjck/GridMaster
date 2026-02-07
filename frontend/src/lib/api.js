import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.PROD ? '/api' : 'http://localhost:8080/api',
    timeout: 10000,
});

// dateStr optional: "YYYY-MM-DD"
// symbol optional: "512890"
export const getKlines = async (dateStr = '', symbol = '') => {
    let url = '/klines';
    const params = [];
    if (dateStr) params.push(`date=${dateStr}`);
    if (symbol) params.push(`symbol=${symbol}`);

    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    const response = await api.get(url);
    return response.data.data;
};

export const getDailyKlines = async (dateStr = '', symbol = '') => {
    let url = '/klines/daily';
    const params = [];
    if (dateStr) params.push(`date=${dateStr}`);
    if (symbol) params.push(`symbol=${symbol}`);

    if (params.length > 0) {
        url += '?' + params.join('&');
    }
    const response = await api.get(url);
    return response.data.data;
};

export const getAvailableDates = async (symbol = '') => {
    const url = symbol ? `/dates?symbol=${symbol}` : '/dates';
    const response = await api.get(url);
    return response.data.data;
};

export const runSimulation = async (config) => {
    const response = await api.post('/simulate', config);
    return response.data;
};

export default api;
