// frontend/src/lib/useMarketSocket.js
import { useEffect, useRef, useCallback } from 'react';

const WS_URL = 'ws://localhost:8080/api/ws';
const MAX_RETRY_DELAY = 30000;

/**
 * useMarketSocket - 订阅后端 WebSocket 行情推送
 *
 * @param {string} symbol - 当前关注的标的，只处理匹配的事件
 * @param {function} onUpdate - 收到匹配事件时的回调
 * @param {boolean} active - 是否激活连接（false 时断开并停止重连）
 */
export function useMarketSocket(symbol, onUpdate, active = true) {
    const wsRef = useRef(null);
    const retryTimerRef = useRef(null);
    const retryDelayRef = useRef(1000);
    const activeRef = useRef(active);
    const symbolRef = useRef(symbol);
    const onUpdateRef = useRef(onUpdate);

    // 保持 ref 最新，避免闭包捕获旧值
    useEffect(() => { activeRef.current = active; }, [active]);
    useEffect(() => { symbolRef.current = symbol; }, [symbol]);
    useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

    const connect = useCallback(() => {
        if (!activeRef.current) return;
        // 如果已有连接且未关闭，不重复创建
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log(`WebSocket connected for symbol: ${symbolRef.current}`);
            retryDelayRef.current = 1000;
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log(`WebSocket received message:`, data);
                if (
                    data.type === 'kline_updated' &&
                    data.symbol === symbolRef.current
                ) {
                    console.log(`WebSocket triggering update for symbol: ${data.symbol}`);
                    onUpdateRef.current(data);
                }
            } catch (e) {
                // 忽略非 JSON 消息
            }
        };

        ws.onclose = () => {
            wsRef.current = null;
            if (!activeRef.current) return;
            retryTimerRef.current = setTimeout(() => {
                retryDelayRef.current = Math.min(
                    retryDelayRef.current * 2,
                    MAX_RETRY_DELAY
                );
                connect();
            }, retryDelayRef.current);
        };

        ws.onerror = () => {
            ws.close();
        };
    }, []); // 无外部依赖，connect 引用永远稳定

    useEffect(() => {
        if (active) {
            connect();
        } else {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            clearTimeout(retryTimerRef.current);
        }

        return () => {
            activeRef.current = false;
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            clearTimeout(retryTimerRef.current);
        };
    }, [active, connect]);
}
