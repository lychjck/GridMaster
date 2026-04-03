# 项目结构

```
.
├── backend/                  # Go 后端（Gin + GORM + WebSocket）
│   ├── main.go               # 入口，路由定义，CORS，后台刷新协程
│   ├── hub.go                # WebSocket Hub（客户端管理、广播）
│   ├── simulation.go         # 网格交易模拟引擎 + 批量参数扫描
│   └── go.mod / go.sum
│
├── frontend/                 # React 单页应用（Vite）
│   ├── src/
│   │   ├── App.jsx           # 根组件（渲染 Dashboard）
│   │   ├── main.jsx          # 入口（ThemeProvider 包裹 App）
│   │   ├── components/
│   │   │   ├── Dashboard.jsx         # 主页面：标的选择、日期选择、图表/模拟标签页
│   │   │   ├── VolatilityChart.jsx   # 分钟 K 线 + 网格叠加层（ECharts）
│   │   │   ├── DailyKChart.jsx       # 日 K 线图
│   │   │   ├── SimulationPanel.jsx   # 回测配置与结果展示
│   │   │   ├── TradeChart.jsx        # 交易可视化
│   │   │   ├── GridDensityChart.jsx  # 网格密度热力图
│   │   │   ├── ParameterSweepChart.jsx # 批量模拟结果图
│   │   │   └── CyberDatePicker.jsx   # 自定义日期选择器
│   │   ├── lib/
│   │   │   ├── api.js                # Axios 客户端，所有 API 调用
│   │   │   ├── useMarketSocket.js    # WebSocket Hook（自动重连 + 指数退避）
│   │   │   └── ThemeContext.jsx       # 主题 Provider（6 套主题，CSS 自定义属性）
│   │   ├── index.css          # 全局样式 + TailwindCSS
│   │   └── App.css
│   └── vite.config.js
│
├── scripts/                  # Python 数据抓取脚本（由后端调用）
│   ├── fetch_data_mootdx.py  # A股数据，通过 mootdx（1m/5m/日线）
│   ├── fetch_binance.py      # 加密货币数据，通过币安 API
│   ├── fetch_hk_data.py      # 港股数据
│   ├── fetch_gold_sina.py    # 黄金价格，通过新浪接口
│   ├── get_stock_name.py     # A股代码 → 名称解析
│   ├── deploy.sh             # 完整构建 + 部署脚本
│   ├── nginx_wangge.conf     # Nginx 反向代理配置
│   └── wangge.service        # Systemd 服务单元
│
├── data/
│   └── market.db             # SQLite 数据库（K线 + 标的数据）
│
├── pyproject.toml            # Python 项目配置（uv）
├── uv.lock                   # Python 依赖锁定文件
└── ROADMAP.md                # 功能路线图
```

## 关键模式
- 前端是单页应用，`Dashboard.jsx` 是主组件，包含大部分 UI 状态（较为庞大）
- 后端路由直接定义在 `main.go` 中，未拆分到独立的 handler 文件
- Python 脚本是独立的命令行工具，Go 后端通过 `uv run` 调用它们
- WebSocket 采用 Hub 模式：单个 goroutine 管理所有客户端连接，后台刷新协程通过 `hub.Broadcast()` 广播更新
- API 基础路径：生产环境 `/api`（Nginx 代理），开发环境 `http://localhost:8080/api`
