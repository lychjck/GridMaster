import requests
import sqlite3
import datetime
import argparse
from pathlib import Path

# Configuration
DB_PATH = (Path(__file__).parent / "../data/market.db").resolve()
URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
UT_TOKEN = "7eea3edcaed734bea9cbfc24409ed989"

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Common schema for both tables with Symbol support
    # Primary Key is now (symbol, timestamp)
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
            f62 REAL,
            f63 REAL,
            f64 REAL,
            PRIMARY KEY (symbol, timestamp)
        )
    '''
    
    c.execute(f'CREATE TABLE IF NOT EXISTS klines_1m {create_sql}')
    c.execute(f'CREATE TABLE IF NOT EXISTS klines_5m {create_sql}')
    c.execute(f'CREATE TABLE IF NOT EXISTS klines_daily {create_sql}')
    
    # Create Unified View for Intraday (ignore daily)
    c.execute('DROP VIEW IF EXISTS klines_all')
    c.execute('''
        CREATE VIEW klines_all AS 
        SELECT '1m' as period, * FROM klines_1m 
        UNION ALL 
        SELECT '5m' as period, * FROM klines_5m
        ORDER BY timestamp
    ''')
    
    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}.")

def fetch_data(symbol, market, klt):
    # klt: "1" or "5" or "101" (daily)
    params = {
        "secid": f"{market}.{symbol}",
        "fields1": "f1,f2,f3,f4,f5,f6",
        # Request all fields f51 to f64
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64",
        "klt": str(klt),
        "fqt": "0", 
        "ut": UT_TOKEN,
        "beg": "0",
        "end": "20500000"
    }
    
    try:
        print(f"Fetching klt={klt} data for {symbol} from {URL}...")
        res = requests.get(URL, params=params, timeout=10)
        data = res.json()
        
        if data["rc"] != 0:
            print(f"API Error: {data.get('msg')}")
            return []
            
        if not data["data"] or not data["data"]["klines"]:
            print(f"No data received for {symbol} (klt={klt}).")
            return []
            
        klines = data["data"]["klines"]
        print(f"Received {len(klines)} records for {symbol} (klt={klt}).")
        
        records = []
        for k in klines:
            # "ts,open,close,high,low,vol,amt,amp,pct,diff,turn,f62,f63,f64"
            parts = k.split(",")
            if len(parts) < 6: 
                continue

            r = {
                "symbol": symbol,
                "timestamp": parts[0],
                "open": float(parts[1]),
                "close": float(parts[2]),
                "high": float(parts[3]),
                "low": float(parts[4]),
                "volume": int(parts[5]),
                "amount": float(parts[6]) if len(parts) > 6 else 0.0,
                "amplitude": float(parts[7]) if len(parts) > 7 else 0.0,
                "change_pct": float(parts[8]) if len(parts) > 8 else 0.0,
                "change_amt": float(parts[9]) if len(parts) > 9 else 0.0,
                "turnover": float(parts[10]) if len(parts) > 10 else 0.0,
                "f62": float(parts[11]) if len(parts) > 11 else 0.0,
                "f63": float(parts[12]) if len(parts) > 12 else 0.0,
                "f64": float(parts[13]) if len(parts) > 13 else 0.0,
            }
            records.append(r)
        return records
    except Exception as e:
        print(f"Fetch failed: {e}")
        return []

def save_to_db(records, table_name):
    if not records:
        return
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    tuples = [(r["symbol"], r["timestamp"], r["open"], r["close"], r["high"], r["low"], 
               r["volume"], r["amount"], r["amplitude"], r["change_pct"], 
               r["change_amt"], r["turnover"], r["f62"], r["f63"], r["f64"]) for r in records]
    
    c.executemany(f'''
        INSERT OR REPLACE INTO {table_name} 
        (symbol, timestamp, open, close, high, low, volume, amount, amplitude, change_pct, change_amt, turnover, f62, f63, f64)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', tuples)
    conn.commit()
    conn.close()
    print(f"Saved {len(records)} records to {table_name}.")

def main():
    parser = argparse.ArgumentParser(description="Fetch Market Data")
    parser.add_argument("--symbol", type=str, default="512890", help="Stock Symbol (e.g. 512890)")
    parser.add_argument("--market", type=str, default="1", help="Market ID (1=SH/ETF, 0=SZ)")
    args = parser.parse_args()

    symbol = args.symbol
    market = args.market

    init_db()
    
    print(f"Processing {symbol} (Market: {market})...")

    # Fetch 5 min data
    records_5m = fetch_data(symbol, market, 5)
    save_to_db(records_5m, "klines_5m")
    
    # Fetch 1 min data
    records_1m = fetch_data(symbol, market, 1)
    save_to_db(records_1m, "klines_1m")

    # Fetch Daily data
    records_day = fetch_data(symbol, market, 101)
    save_to_db(records_day, "klines_daily")

if __name__ == "__main__":
    main()
