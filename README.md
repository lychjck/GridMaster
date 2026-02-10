# 红利低波网格分析工具 (Grid Trading Volatility Analysis)

Designed to assist in grid trading strategies for "Dividend Low Volatility" assets (e.g., 512890 ETF).

[Feature Roadmap](./ROADMAP.md)

## Features
- **Data Acquisition**: Python scripts to fetch minute-level market data.
- **Backend API**: Go (Gin) server providing robust data endpoints and SQLite management.
- **Interactive Dashboard**: React + ECharts frontend for visualizing volatility, K-lines, and simulating grid steps.
- **Lazy Loading**: Optimized data fetching for fast initial page loads.

## Tech Stack
- **Frontend**: React, Vite, TailwindCSS, ECharts, Lucide React
- **Backend**: Go, Gin, GORM, SQLite
- **Data**: Python (Requests), SQLite

## Setup

### 1. Data Fetching
```bash
python3 scripts/fetch_data.py
```

### 2. Backend
```bash
cd backend
go run main.go
```
Server runs on `http://localhost:8080`.

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Client runs on `http://localhost:5173`.

## Data Source
Currently configured for EastMoney API.
