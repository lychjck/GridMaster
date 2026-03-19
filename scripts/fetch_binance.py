import sqlite3
import argparse
import time
import os
from pathlib import Path
import pandas as pd
from binance.spot import Spot
from datetime import datetime, timezone

# Configuration
DB_PATH = (Path(__file__).parent / "../data/market.db").resolve()

# 优先级：环境变量 BINANCE_PROXY > 自动检测
env_proxy = os.getenv("BINANCE_PROXY")
PROXIES = {
    'http': env_proxy,
    'https': env_proxy
} if env_proxy else None

# 优先级：环境变量 BINANCE_BASE_URL > 官方列表
env_base_url = os.getenv("BINANCE_BASE_URL")

# 币安备用域名列表
BASE_URLS = [
    "https://api.binance.cc",      # 官方国内直连镜像（首选）
    "https://api.binancezh.com",   # 官方国内直连镜像
    "https://api.binancezh.pro",   # 官方国内直连镜像
    "https://api.binance.vision",
    "https://api.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://api4.binance.com",
    "https://api5.binance.com",
    "https://api-g1.binance.com",
]

if env_base_url:
    BASE_URLS.insert(0, env_base_url)

def get_client():
    """尝试不同的域名直到找到可用的"""
    
    for url in BASE_URLS:
        try:
            client = Spot(base_url=url, proxies=PROXIES, timeout=10)
            # 探测逻辑：尝试拉取 1 条 BTC 的 1 分钟 K 线数据，能拉到说明行情接口可用
            # 不使用 ping() 是因为某些代理 IP 虽然被币安屏蔽了交易，但依然可以看行情
            client.klines(symbol="BTCUSDT", interval="1m", limit=1)
            print(f"  [连接成功] 使用地址: {url}", flush=True)
            return client
        except:
            continue
    print("  [警告] 所有官方镜像及代理均不可用，将尝试默认回退。", flush=True)
    return Spot(proxies=PROXIES)

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    c = conn.cursor()
    create_sql = '''
        (
            symbol TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            open REAL NOT NULL,
            close REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            volume INTEGER NOT NULL,
            amount REAL,
            amplitude REAL,
            change_pct REAL,
            change_amt REAL,
            turnover REAL,
            f62 REAL, f63 REAL, f64 REAL,
            PRIMARY KEY (symbol, timestamp)
        )
    '''
    c.execute(f'CREATE TABLE IF NOT EXISTS klines_1m {create_sql}')
    c.execute(f'CREATE TABLE IF NOT EXISTS klines_5m {create_sql}')
    c.execute(f'CREATE TABLE IF NOT EXISTS klines_daily {create_sql}')
    c.execute('CREATE TABLE IF NOT EXISTS symbols (symbol TEXT PRIMARY KEY, name TEXT, market INTEGER)')
    conn.commit()
    conn.close()

def get_table_name(interval):
    return 'klines_daily' if interval == '1d' else f"klines_{interval}"

def get_db_bounds(symbol, table_name):
    try:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        c = conn.cursor()
        c.execute(f"SELECT MIN(timestamp), MAX(timestamp) FROM {table_name} WHERE symbol=?", (symbol.upper(),))
        row = c.fetchone()
        conn.close()
        def to_ms(val):
            if not val: return None
            fmt = '%Y-%m-%d %H:%M' if ' ' in val else '%Y-%m-%d'
            return int(datetime.strptime(val, fmt).replace(tzinfo=timezone.utc).timestamp() * 1000)
        return to_ms(row[0]), to_ms(row[1])
    except:
        return None, None

def fetch_batch(client, symbol, interval, end_time=None):
    params = {"symbol": symbol.upper(), "interval": interval, "limit": 1000}
    if end_time: params["endTime"] = end_time
    for attempt in range(3):
        try:
            return client.klines(**params)
        except Exception as e:
            print(f"    [Retry {attempt+1}] 请求失败: {e}", flush=True)
            time.sleep(2)
    return None

def sync_symbol_full(symbol, interval):
    client = get_client()
    table_name = get_table_name(interval)
    print(f"\n>>> 开始全量同步 {symbol} ({interval}) ...", flush=True)

    # 1. 贪婪同步：从“现在”开始往回拉
    print(f"  [步骤1] 正在同步最新数据并填补缺口...", flush=True)
    current_end = None
    fill_count = 0
    while True:
        klines = fetch_batch(client, symbol, interval, end_time=current_end)
        if not klines: break
        records = []
        for k in klines:
            ts = datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc)
            ts_str = ts.strftime('%Y-%m-%d %H:%M' if interval != '1d' else '%Y-%m-%d')
            records.append({
                "symbol": symbol.upper(), "timestamp": ts_str,
                "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4]),
                "volume": int(float(k[5])), "amount": float(k[7]),
                "amplitude": 0.0, "change_pct": 0.0, "change_amt": 0.0, "turnover": 0.0,
                "f62": 0.0, "f63": 0.0, "f64": 0.0,
            })
        save_to_db(records, table_name)
        fill_count += len(records)
        oldest_in_batch = klines[0][0]
        print(f"    进度: [{interval}] 已同步至 {records[0]['timestamp']}", flush=True)
        _, db_max = get_db_bounds(symbol, table_name)
        if db_max and oldest_in_batch <= db_max:
            print(f"    [OK] [{interval}] 已与数据库对接。", flush=True)
            break
        current_end = oldest_in_batch - 1
        time.sleep(0.1)

    # 2. 深度挖掘
    print(f"  [步骤2] 正在深度回溯 [{interval}] 历史全量数据...", flush=True)
    db_min, _ = get_db_bounds(symbol, table_name)
    current_end = (db_min - 1) if db_min else None
    back_count = 0
    while True:
        klines = fetch_batch(client, symbol, interval, end_time=current_end)
        if not klines or len(klines) == 0: break
        records = []
        for k in klines:
            ts = datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc)
            ts_str = ts.strftime('%Y-%m-%d %H:%M' if interval != '1d' else '%Y-%m-%d')
            records.append({
                "symbol": symbol.upper(), "timestamp": ts_str,
                "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4]),
                "volume": int(float(k[5])), "amount": float(k[7]),
                "amplitude": 0.0, "change_pct": 0.0, "change_amt": 0.0, "turnover": 0.0,
                "f62": 0.0, "f63": 0.0, "f64": 0.0,
            })
        save_to_db(records, table_name)
        back_count += len(records)
        current_end = klines[0][0] - 1
        print(f"    进度: [{interval}] 回溯至 {records[0]['timestamp']} ...", flush=True)
        if len(klines) < 1000: break
        time.sleep(0.1)
    print(f">>> [{interval}] 同步完成！新增: {fill_count + back_count} 条。", flush=True)

def save_to_db(records, table_name):
    if not records: return
    conn = sqlite3.connect(DB_PATH, timeout=30)
    c = conn.cursor()
    tuples = [(r["symbol"], r["timestamp"], r["open"], r["close"], r["high"], r["low"], 
               r["volume"], r["amount"], r["amplitude"], r["change_pct"], 
               r["change_amt"], r["turnover"], r["f62"], r["f63"], r["f64"]) for r in records]
    c.executemany(f'INSERT OR REPLACE INTO {table_name} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', tuples)
    conn.commit()
    conn.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", required=True)
    args = parser.parse_args()
    init_db()
    for symbol in args.symbols.split(","):
        symbol = symbol.strip().upper()
        if not symbol: continue
        conn = sqlite3.connect(DB_PATH)
        conn.cursor().execute('INSERT OR REPLACE INTO symbols (symbol, name, market) VALUES (?, ?, 100)', (symbol, symbol.replace("USDT","")))
        conn.commit()
        conn.close()
        sync_symbol_full(symbol, '1d')
        sync_symbol_full(symbol, '5m')
        sync_symbol_full(symbol, '1m')

if __name__ == "__main__":
    main()
