// frontend/src/lib/useMarketSocket.js
import { useEffect, useRef, useCallback } from 'react';

// TODO: 生产环境可改为 import.meta.env.VITE_WS_URL
const WS_URL = 'ws://localhost:8080/api/ws';
const MAX_RETRY_DELAY = 30000; // 最大重连间隔30秒

/**
 * useMarketSocket - 订阅后端 WebSocket 行情推送
 *
 * @param {string} symbol - 当前关注的标的，只处理匹配的事件
 * @param {function} onUpdate - 收到匹配事件时的回调，调用方必须用 useCallback 包裹
 * @param {boolean} active - 是否激活连接（false 时断开并停止重连）
 */
export function useMarketSocket(symbol, onUpdate, active = true) {
    const wsRef = useRef(null);
    const retryTimerRef = useRef(null);
    const retryDelayRef = useRef(1000);
    const activeRef = useRef(active);
    const symbolRef = useRef(symbol);

    // 保持 ref 最新，避免闭包捕获旧值
    useEffect(() => { activeRef.current = active; }, [active]);
    useEffect(() => { symbolRef.current = symbol; }, [symbol]);

    const connect = useCallback(() => {
        if (!activeRef.current) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            retryDelayRef.current = 1000; // 连接成功，重置退避间隔
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (
                    data.type === 'kline_updated' &&
                    data.symbol === symbolRef.current
                ) {
                    onUpdate(data);
                }
            } catch (e) {
                // 忽略非 JSON 消息
            }
        };

        ws.onclose = () => {
            if (!activeRef.current) return;
            // 指数退避重连
            retryTimerRef.current = setTimeout(() => {
                retryDelayRef.current = Math.min(
                    retryDelayRef.current * 2,
                    MAX_RETRY_DELAY
                );
                connect();
            }, retryDelayRef.current);
        };

        ws.onerror = () => {
            ws.close(); // 触发 onclose，由 onclose 负责重连
        };
    }, [onUpdate]); // onUpdate 必须稳定（调用方用 useCallback 保证）

    useEffect(() => {
        if (active) {
            connect();
        } else {
            wsRef.current?.close();
            clearTimeout(retryTimerRef.current);
        }

        return () => {
            activeRef.current = false;
            wsRef.current?.close();
            clearTimeout(retryTimerRef.current);
        };
    }, [active, connect]);
}
