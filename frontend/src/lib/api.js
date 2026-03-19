import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.PROD ? '/api' : 'http://localhost:8080/api',
    timeout: 60000,
});

const utcToBeijing = (ts) => {
    if (!ts) return ts;
    const hasTime = ts.includes(' ');
    const isoStr = hasTime ? ts.replace(' ', 'T') + 'Z' : ts + 'T00:00:00Z';
    const d = new Date(isoStr);
    // 使用 UTC 方法，避免本地时区干扰
    const utcMs = d.getTime() + 8 * 3600 * 1000;
    const pad = (n) => String(n).padStart(2, '0');
    const y = new Date(utcMs).getUTCFullYear();
    const m = new Date(utcMs).getUTCMonth() + 1;
    const day = new Date(utcMs).getUTCDate();
    const h = new Date(utcMs).getUTCHours();
    const min = new Date(utcMs).getUTCMinutes();
    const date = `${y}-${pad(m)}-${pad(day)}`;
    if (!hasTime) return date;
    return `${date} ${pad(h)}:${pad(min)}`;
};

const convertTimestamps = (data, symbol) => {
    if (!symbol?.toUpperCase().endsWith('USDT')) return data;
    return data.map(item => ({ ...item, timestamp: utcToBeijing(item.timestamp) }));
};

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
    return convertTimestamps(response.data.data, symbol);
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
    return convertTimestamps(response.data.data, symbol);
};

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

export default api;
