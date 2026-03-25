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
			if len(failed) > 0 {
				log.Printf("WS: %d client(s) removed due to full send buffer, total=%d", len(failed), len(h.clients))
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
			log.Printf("WS: write error: %v", err)
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
		// 当前版本不处理客户端上行消息，仅消费数据以维持心跳并检测断线
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
	}
}
