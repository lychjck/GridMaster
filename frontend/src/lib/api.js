import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.PROD ? '/api' : 'http://localhost:8080/api',
    timeout: 60000,
});

const utcToBeijing = (ts) => {
    if (!ts) return ts;
    const hasTime = ts.includes(' ');
    const isoStr = hasTime ? ts.replace(' ', 'T') + 'Z' : ts + 'T00:00:00Z';
    const utcMs = new Date(isoStr).getTime();
    if (isNaN(utcMs)) return ts; // 无效时间戳，返回原值
    const bjMs = utcMs + 8 * 3600 * 1000;
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date(bjMs);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const h = d.getUTCHours();
    const min = d.getUTCMinutes();
    const date = `${y}-${pad(m)}-${pad(day)}`;
    if (!hasTime) return date;
    return `${date} ${pad(h)}:${pad(min)}`;
};

const convertTimestamps = (data, symbol) => {
    if (!symbol?.toUpperCase().endsWith('USDT')) return data;
    return data.map(item => ({ ...item, timestamp: utcToBeijing(item.timestamp) }));
};

const fetchKlines = async (endpoint, dateStr, symbol) => {
    const params = [];
    if (dateStr) params.push(`date=${dateStr}`);
    if (symbol) params.push(`symbol=${symbol}`);
    const url = params.length > 0 ? `${endpoint}?${params.join('&')}` : endpoint;
    const response = await api.get(url);
    return convertTimestamps(response.data.data, symbol);
};

export const getKlines = (dateStr = '', symbol = '') => fetchKlines('/klines', dateStr, symbol);
export const getDailyKlines = (dateStr = '', symbol = '') => fetchKlines('/klines/daily', dateStr, symbol);

export const getAvailableDates = async (symbol = '') => {
    const url = symbol
        ? `/dates?symbol=${symbol}&_t=${Date.now()}`
        : `/dates?_t=${Date.now()}`;
    const response = await api.get(url);
    return response.data.data || [];
};

export const runSimulation = async (config) => {
    const response = await api.post('/simulate', config);
    return response.data;
};

export const runBatchSimulation = async (config) => {
    const response = await api.post('/simulate/batch', config);
    return response.data.data;
};

export const getSymbols = async () => {
    const response = await api.get('/symbols');
    return response.data.data;
};

export const addSymbol = async (symbol) => {
    const response = await api.post('/symbols', { symbol });
    return response.data;
};

export const deleteSymbol = async (symbol) => {
    const response = await api.delete(`/symbols/${symbol}`);
    return response.data;
};

export const refreshData = async (symbol) => {
    const response = await api.post('/refresh', { symbol });
    return response.data;
};

export const fullSyncData = async (symbol) => {
    const response = await api.post('/sync/full', { symbol });
    return response.data;
};

export default api;
