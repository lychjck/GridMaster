# WebSocket 实时推送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端A股/港股刷新间隔从5分钟改为1分钟，并通过 WebSocket 在数据更新后主动推送事件通知，前端收到通知后重新拉取 `/api/klines`，替代现有的60秒轮询刷新。

**Architecture:** 后端新增 `hub.go` 实现 WebSocket 连接管理（gorilla/websocket），刷新 goroutine 在 Python 脚本成功后调用 `hub.Broadcast()`。前端新增 `useMarketSocket.js` hook 封装连接逻辑和自动重连，`Dashboard.jsx` 移除 `setInterval` 改用 hook 回调触发数据刷新。

**Tech Stack:** Go + gorilla/websocket，React 原生 WebSocket API（无需新增前端依赖）

---

## 文件清单

### 后端（新建/修改）
- **新建** `backend/hub.go` — WebSocket Hub，管理连接、广播
- **修改** `backend/main.go` — 引入 gorilla/websocket，注册 `/api/ws` 路由，刷新间隔改为1分钟，成功后调用广播

### 前端（新建/修改）
- **新建** `frontend/src/lib/useMarketSocket.js` — WebSocket hook，封装连接、消息过滤、自动重连
- **修改** `frontend/src/components/Dashboard.jsx` — 移除 `setInterval` 自动刷新，改用 `useMarketSocket`

---

## Task 1: 安装 gorilla/websocket 依赖

**Files:**
- Modify: `backend/go.mod`, `backend/go.sum`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/liyanran/github/wangge/backend
go get github.com/gorilla/websocket@latest
```

Expected output: `go: added github.com/gorilla/websocket v1.x.x`

- [ ] **Step 2: 验证 go.mod 已更新**

```bash
grep gorilla /Users/liyanran/github/wangge/backend/go.mod
```

Expected: `github.com/gorilla/websocket v1.x.x`

- [ ] **Step 3: Commit**

```bash
cd /Users/liyanran/github/wangge
git add backend/go.mod backend/go.sum
git commit -m "chore: add gorilla/websocket dependency"
```

---

## Task 2: 实现 WebSocket Hub

**Files:**
- Create: `backend/hub.go`

**关键并发设计说明：**
- Hub 的事件循环（`Run()`）是单 goroutine，所有 `clients` map 的读写都发生在这个 goroutine 内，无需加锁
- `writePump` 和 `readPump` 各跑一个 goroutine；只有 `readPump` 负责向 `unregister` 发送信号，`writePump` 监听 `send` channel 关闭后自然退出，避免双重 unregister
- Hub 通过 channel 通信，无共享内存竞争

- [ ] **Step 1: 创建 `backend/hub.go`**

```go
package main

import (
	"log"

	"github.com/gorilla/websocket"
)

// Client 代表一个 WebSocket 连接
type Client struct {
	conn *websocket.Conn
	send chan []byte
}

// Hub 管理所有 WebSocket 连接，单 goroutine 运行，无需加锁
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
}

func newHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run 是 Hub 的主循环，必须在独立 goroutine 中运行
// 所有对 clients map 的操作都在这个 goroutine 内，无并发问题
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			log.Printf("WS: client connected, total=%d", len(h.clients))

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send) // 关闭 send channel，通知 writePump 退出
			}
			log.Printf("WS: client disconnected, total=%d", len(h.clients))

		case message := <-h.broadcast:
			// 收集发送失败的 client，在循环外处理，避免迭代时修改 map
			var failed []*Client
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					// 发送缓冲已满，标记为失败
					failed = append(failed, client)
				}
			}
			for _, client := range failed {
				delete(h.clients, client)
				close(client.send)
			}
		}
	}
}

// Broadcast 向所有连接的客户端广播消息，可从任意 goroutine 调用
func (h *Hub) Broadcast(message []byte) {
	select {
	case h.broadcast <- message:
	default:
		log.Println("WS: broadcast channel full, dropping message")
	}
}

// writePump 将 send channel 中的消息写入 WebSocket 连接
// 当 send channel 被 Hub 关闭后，range 循环自然退出
func (c *Client) writePump() {
	defer c.conn.Close()
	for message := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}

// readPump 持续读取客户端消息以维持连接活跃，并负责在连接断开时触发 unregister
// 只有 readPump 向 hub.unregister 发送信号，避免与 writePump 双重 close
func (c *Client) readPump(h *Hub) {
	defer func() {
		h.unregister <- c
		c.conn.Close()
	}()
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
	}
}
```

- [ ] **Step 2: 编译验证**

```bash
cd /Users/liyanran/github/wangge/backend
go build ./...
```

Expected: 无报错输出

- [ ] **Step 3: Commit**

```bash
cd /Users/liyanran/github/wangge
git add backend/hub.go
git commit -m "feat: add websocket hub with safe concurrent client management"
```

---

## Task 3: 注册 WebSocket 路由，改造刷新 goroutine

**Files:**
- Modify: `backend/main.go`

需要做4处改动：
1. import 增加 `github.com/gorilla/websocket`
2. 全局变量新增 `var hub *Hub`
3. `main()` 中初始化并启动 hub，注册 `/api/ws` 路由
4. `startAStockRefresh` / `startHKStockRefresh` sleep 改为1分钟，脚本成功后广播

- [ ] **Step 1: 在 `main.go` 的 import 块中添加 gorilla/websocket**

在 `backend/main.go` 的 import 块中添加：
```go
"github.com/gorilla/websocket"
```

- [ ] **Step 2: 在 `var DB *gorm.DB` 下方添加全局变量**

```go
var hub *Hub

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 开发阶段允许所有来源
	},
}
```

- [ ] **Step 3: 在 `main()` 函数中初始化 hub，放在启动 goroutine 之前**

找到以下代码（main.go 第68-71行）：
```go
// Start Background Refresh Tasks
go startAStockRefresh()
go startBinanceRefresh()
go startHKStockRefresh()
```

替换为：
```go
// Start WebSocket Hub（必须在 refresh goroutine 之前初始化，确保 hub != nil）
hub = newHub()
log.Println("Starting WebSocket Hub")
go hub.Run()

// Start Background Refresh Tasks
go startAStockRefresh()
go startBinanceRefresh()
go startHKStockRefresh()
```

- [ ] **Step 4: 在 `r.GET("/api/klines/daily", ...)` 路由之后注册 WebSocket 路由**

```go
// GET /api/ws - WebSocket 实时推送端点
r.GET("/api/ws", func(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
		return
	}
	client := &Client{conn: conn, send: make(chan []byte, 64)}
	hub.register <- client
	go client.writePump()      // writePump 不再接受 hub 参数，由 send channel 关闭驱动退出
	go client.readPump(hub)    // readPump 负责 unregister
})
```

- [ ] **Step 5: 改造 `startAStockRefresh`**

**改动1**：函数开头日志改为（第536行）：
```go
log.Println("Starting A-Stock background refresh task (every 1 min during trading hours)...")
```

**改动2**：在脚本成功的 else 分支（第558行附近）添加广播。将：
```go
} else {
    log.Printf("A-Stock Refresh: Success for %s", s.Symbol)
}
```
替换为：
```go
} else {
    log.Printf("A-Stock Refresh: Success for %s", s.Symbol)
    if hub != nil {
        msg, _ := json.Marshal(map[string]string{
            "type":      "kline_updated",
            "symbol":    s.Symbol,
            "timestamp": time.Now().Format("2006-01-02 15:04:05"),
        })
        hub.Broadcast(msg)
    }
}
```

**改动3**：函数末尾 sleep 从5分钟改为1分钟（第567行）：
```go
time.Sleep(1 * time.Minute)
```

- [ ] **Step 6: 同样改造 `startHKStockRefresh`**

与 Step 5 完全相同的3处改动，注意：

港股在 `symbols` 表中存储的是不带 `HK.` 前缀的原始 symbol（如 `00700`），`HK.` 前缀只在传给 Python 脚本时才使用。因此广播时直接用 `s.Symbol` 即可，**无需** TrimPrefix：

```go
} else {
    log.Printf("HK-Stock Refresh: Success for %s", s.Symbol)
    if hub != nil {
        msg, _ := json.Marshal(map[string]string{
            "type":      "kline_updated",
            "symbol":    s.Symbol,  // 直接用，已是不带 HK. 前缀的原始 symbol
            "timestamp": time.Now().Format("2006-01-02 15:04:05"),
        })
        hub.Broadcast(msg)
    }
}
```

sleep 同样改为 `time.Sleep(1 * time.Minute)`，日志也改为 `every 1 min`。

- [ ] **Step 7: 编译验证**

```bash
cd /Users/liyanran/github/wangge/backend
go build ./...
```

Expected: 无报错

- [ ] **Step 8: Commit**

```bash
cd /Users/liyanran/github/wangge
git add backend/main.go
git commit -m "feat: add /api/ws endpoint and broadcast on kline update, refresh interval 5min→1min"
```

---

## Task 4: 前端 useMarketSocket hook

**Files:**
- Create: `frontend/src/lib/useMarketSocket.js`

**重要契约：** 调用方传入的 `onUpdate` 回调**必须**用 `useCallback` 包裹，否则每次父组件 render 都会产生新的函数引用，导致 hook 内 `connect` 函数重建，进而触发 WebSocket 频繁重连。

- [ ] **Step 1: 创建 hook 文件**

```js
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
```

- [ ] **Step 2: Commit**

```bash
cd /Users/liyanran/github/wangge
git add frontend/src/lib/useMarketSocket.js
git commit -m "feat: add useMarketSocket hook with exponential backoff reconnect"
```

---

## Task 5: 改造 Dashboard.jsx，移除轮询改用 WebSocket

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx`

- [ ] **Step 1: 在 Dashboard.jsx 顶部 import 中添加两项**

找到现有 import 列表，添加：
```js
import { useMarketSocket } from '../lib/useMarketSocket';
```

同时确认 React hooks 的 import 中包含 `useCallback`，如没有则补上：
```js
import React, { useState, useEffect, useRef, useCallback, ... } from 'react';
```

- [ ] **Step 2: 找到并删除 setInterval 自动刷新 useEffect**

用以下特征字符串在文件中定位目标 useEffect（在编辑器中搜索）：
```
setInterval(backgroundFetchData, 60000)
```
或：
```
setInterval(() => { backgroundFetchData
```

找到该 useEffect 后，完整删除从 `useEffect(() => {` 到对应 `}, [...]);` 的整个块。该块的 deps 数组为：
```js
[selectedDate, selectedSymbol, availableDates, activeTab, showLiveTrades, autoRefreshEnabled]
```
可用此 deps 内容辅助确认是正确的 useEffect。

- [ ] **Step 3: 在删除位置添加 useMarketSocket 调用**

`todayStr` 在 Dashboard.jsx 第64行附近定义于组件顶层，直接使用即可，无需重新定义。

```js
// WebSocket 实时推送：替代60秒轮询
// wsActive 条件与原 setInterval 逻辑一致：今日数据 + 非回测tab + 未展示实时成交
const wsActive =
    autoRefreshEnabled &&
    !!selectedSymbol &&
    selectedDate === todayStr &&
    activeTab !== 'simulation' &&
    !showLiveTrades;

// onUpdate 用 useCallback 包裹，确保引用稳定，避免 socket 频繁重连
const handleWsUpdate = useCallback(() => {
    backgroundFetchData();
}, [backgroundFetchData]);

useMarketSocket(selectedSymbol, handleWsUpdate, wsActive);
```

- [ ] **Step 4: 验证前端编译**

```bash
cd /Users/liyanran/github/wangge/frontend
npm run build 2>&1 | tail -20
```

Expected: `✓ built in` 无报错，无 ESLint 警告

- [ ] **Step 5: Commit**

```bash
cd /Users/liyanran/github/wangge
git add frontend/src/components/Dashboard.jsx
git commit -m "feat: replace 60s polling with websocket push in Dashboard"
```

---

## Task 6: 手动集成测试

- [ ] **Step 1: 启动后端，验证日志**

```bash
cd /Users/liyanran/github/wangge/backend
go run .
```

Expected 日志中出现（顺序如下）：
```
Starting WebSocket Hub
Starting A-Stock background refresh task (every 1 min during trading hours)...
Starting HK-Stock background refresh task (every 1 min during trading hours)...
Starting Binance background refresh task (every 1 min)...
```

- [ ] **Step 2: 启动前端**

```bash
cd /Users/liyanran/github/wangge/frontend
npm run dev
```

- [ ] **Step 3: 验证 WebSocket 连接建立**

打开浏览器 DevTools → Network → 筛选 `WS`，应看到：
- 连接到 `ws://localhost:8080/api/ws` 的状态 101 Switching Protocols
- 连接保持 `pending`（长连接持续存在）

- [ ] **Step 4: 验证 symbol 过滤（不同 symbol 的消息不触发刷新）**

在 DevTools Console 执行以下代码模拟一条其他 symbol 的 WS 消息（正常情况下前端不发消息，这里手动测试过滤逻辑）：

切换 Dashboard 选中的 symbol，确认 WS 消息面板中收到的事件 symbol 与当前选中 symbol 一致时才会触发 `/api/klines` 请求（Network 面板），不匹配时不触发。

- [ ] **Step 5: 验证交易时间内推送（交易日 9:30-11:30 或 13:00-15:00 执行）**

等待约1分钟，后端日志应出现：
```
A-Stock Refresh: Success for 512890
```

DevTools WS 消息面板应收到：
```json
{"symbol":"512890","timestamp":"2026-03-25 10:01:00","type":"kline_updated"}
```

同时 Network 面板出现新的 `/api/klines` 请求，VolatilityChart 自动刷新。

- [ ] **Step 6: 验证非交易时间无推送**

非交易时间（如收盘后），后端日志应出现：
```
A-Stock Refresh: Non-trading time, skipping...
```

前端 WS 连接保持，不会收到 `kline_updated` 事件，前端无异常。

- [ ] **Step 7: 验证断线自动重连**

后端进程按 Ctrl+C 停止 → 前端 WS 连接断开 → 等待约1-2秒后重启后端 → DevTools 出现新的 WS 连接（101 状态），重连成功。

- [ ] **Step 8: 验证 autoRefreshEnabled=false 时 WS 不连接**

在 Dashboard UI 关闭自动刷新开关，DevTools 中现有 WS 连接应关闭，且不再建立新连接。

- [ ] **Step 9: 确认所有文件已提交**

```bash
cd /Users/liyanran/github/wangge
git status
```

Expected: `nothing to commit, working tree clean`
