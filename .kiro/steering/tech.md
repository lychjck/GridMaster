# 技术栈与构建

## 前端
- React 19 + Vite 7（JSX，不使用 TypeScript）
- TailwindCSS v4（通过 `@tailwindcss/vite` 插件集成）
- ECharts 6 + echarts-for-react 做图表
- Axios 做 HTTP 请求，lucide-react 做图标，framer-motion 做动画
- clsx + tailwind-merge 做条件样式拼接
- 状态管理：React Hooks + Context API（ThemeContext），无 Redux 等外部状态库
- 大量使用 localStorage 持久化用户偏好设置

## 后端
- Go 1.25 + Gin Web 框架
- GORM + 纯 Go SQLite 驱动（`glebarez/sqlite`），无需 CGO
- gorilla/websocket 做实时推送（Hub 模式：单 goroutine 管理所有客户端连接）
- 监听端口 8080，REST 接口在 `/api/*`，WebSocket 在 `/api/ws`
- 开发环境 CORS 全开（`*`）

## 数据层
- SQLite 数据库，路径 `data/market.db`
- 数据表：`klines_1m`、`klines_5m`、`klines_daily`、`hk_klines_1m`、`hk_klines_5m`、`hk_klines_daily`、`symbols`
- Python 脚本负责写入数据，Go 后端负责读取和提供接口

## Python 脚本
- Python 3.13，使用 `uv` 管理依赖（pyproject.toml + uv.lock）
- 主要依赖：mootdx（A股数据）、binance-connector、akshare、yfinance、pandas
- Go 后端通过 `uv run scripts/<脚本名>.py` 调用脚本

## 常用命令

### 前端
```bash
cd frontend
npm install        # 安装依赖
npm run dev        # 开发服务器，端口 5173
npm run build      # 生产构建，输出到 frontend/dist/
npm run lint       # ESLint 检查
```

### 后端
```bash
cd backend
go run main.go     # 开发服务器，端口 8080
go build -o wangge-backend .  # 编译二进制
GOOS=linux GOARCH=amd64 go build -o wangge-backend .  # 交叉编译用于部署
```

### 数据抓取
```bash
uv run scripts/fetch_data_mootdx.py --symbols 512890 --count 999999
uv run scripts/fetch_binance.py --symbols BTCUSDT
uv run scripts/fetch_hk_data.py --symbol 00700
uv run scripts/fetch_gold_sina.py
```

### 部署
```bash
bash scripts/deploy.sh   # 前后端构建 + 上传服务器 + 重启服务
```
