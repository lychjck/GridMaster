import sqlite3
import requests
import json
import re
from pathlib import Path

# 配置文件路径
DB_PATH = (Path(__file__).parent / "../data/market.db").resolve()
HEADERS = {"Referer": "http://finance.sina.com.cn"}

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    schema = '''(
        symbol TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        open REAL NOT NULL,
        close REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        volume INTEGER NOT NULL,
        amount REAL DEFAULT 0,
        amplitude REAL DEFAULT 0,
        change_pct REAL DEFAULT 0,
        change_amt REAL DEFAULT 0,
        turnover REAL DEFAULT 0,
        f62 REAL DEFAULT 0,
        f63 REAL DEFAULT 0,
        f64 REAL DEFAULT 0,
        PRIMARY KEY (symbol, timestamp)
    )'''
    c.execute(f'CREATE TABLE IF NOT EXISTS klines_1m {schema}')
    c.execute(f'CREATE TABLE IF NOT EXISTS klines_daily {schema}')
    c.execute('INSERT OR REPLACE INTO symbols (symbol, name, market) VALUES (?, ?, ?)', ("XAU", "国际黄金", 100))
    conn.commit()
    conn.close()

def fetch_sina_min_line(symbol):
    # 分时线 API
    url = f"https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var_{symbol}=/GlobalFuturesService.getGlobalFuturesMinLine?symbol={symbol}&type=1"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code != 200: return []
    
    # 解析 JSONP: var_XAU=({...})
    match = re.search(r'var_.*?=\((.*)\);', resp.text)
    if not match: return []
    
    try:
        data = json.loads(match.group(1))
        min_line = data.get("minLine_1d", [])
        records = []
        for item in min_line:
            # item 格式: ["2026-03-06", "5080.880", "LIFFE", "", "07:00", "5083.760", ... "2026-03-06 07:00:00"]
            # 最后一个元素是完整时间
            ts = item[-1][:16]
            price = float(item[1])
            records.append({
                "symbol": symbol,
                "timestamp": ts,
                "open": price, "high": price, "low": price, "close": price,
                "volume": 0
            })
        return records
    except:
        return []

def fetch_sina_daily_line(symbol):
    # 日线 API
    url = f"https://stock.finance.sina.com.cn/futures/api/jsonp.php/var_{symbol}=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol={symbol}"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code != 200: return []
    
    match = re.search(r'var_.*?=\((.*)\);', resp.text)
    if not match: return []
    
    try:
        data = json.loads(match.group(1))
        records = []
        for item in data:
            # {"date":"2026-03-06","open":"5080.880",...}
            records.append({
                "symbol": symbol,
                "timestamp": item["date"],
                "open": float(item["open"]),
                "high": float(item["high"]),
                "low": float(item["low"]),
                "close": float(item["close"]),
                "volume": int(float(item["volume"]))
            })
        return records
    except:
        return []

def save_to_db(records, table_name):
    if not records: return
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    data = [(r["symbol"], r["timestamp"], r["open"], r["close"], r["high"], r["low"], r["volume"]) for r in records]
    c.executemany(f'''
        INSERT OR REPLACE INTO {table_name} (symbol, timestamp, open, close, high, low, volume)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', data)
    conn.commit()
    conn.close()

def main():
    init_db()
    symbol = "XAU"
    print(f"Fetching {symbol} data...")
    m1 = fetch_sina_min_line(symbol)
    if m1: 
        save_to_db(m1, "klines_1m")
        print(f"Saved {len(m1)} 1m records")
    
    day = fetch_sina_daily_line(symbol)
    if day:
        save_to_db(day, "klines_daily")
        print(f"Saved {len(day)} daily records")
    print("Done.")

if __name__ == "__main__":
    main()
