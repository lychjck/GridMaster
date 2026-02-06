import sqlite3
import argparse
from pathlib import Path
from mootdx.quotes import Quotes
import pandas as pd

# Configuration
DB_PATH = (Path(__file__).parent / "../data/market.db").resolve()

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Common schema for both tables with Symbol support
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

def fetch_data_mootdx(symbol, market, frequency, count=800):
    """
    frequency: 9=daily, 8=1m, 0=5m
    market: 1=SH, 0=SZ
    """
    client = Quotes.factory(market='std')
    try:
        print(f"Fetching freq={frequency} records for {symbol} (Market: {market}) from TDX...")
        
        all_df = []
        chunk_size = 800
        for i in range(0, count, chunk_size):
            current_count = min(chunk_size, count - i)
            print(f"  Requesting chunk {i//chunk_size + 1} (start={i}, count={current_count})...")
            df = client.bars(symbol=symbol, frequency=frequency, start=i, offset=current_count)
            
            if df is None or df.empty:
                break
            all_df.append(df)
            if len(df) < current_count: # No more data
                break
        
        if not all_df:
            print(f"No data received for {symbol} (freq={frequency}).")
            return []
            
        final_df = pd.concat(all_df).sort_index()
        print(f"Total received {len(final_df)} records for {symbol} (freq={frequency}).")
        
        records = []
        # 日线使用 YYYY-MM-DD，分钟线使用 YYYY-MM-DD HH:MM
        ts_format = '%Y-%m-%d' if frequency == 9 else '%Y-%m-%d %H:%M'
        
        for index, row in final_df.iterrows():
            # mootdx column mapping:
            # datetime index, open, close, high, low, vol, amount
            r = {
                "symbol": symbol,
                "timestamp": index.strftime(ts_format),
                "open": float(row['open']),
                "close": float(row['close']),
                "high": float(row['high']),
                "low": float(row['low']),
                "volume": int(row['vol']),
                "amount": float(row['amount']) if 'amount' in row else 0.0,
                "amplitude": 0.0,
                "change_pct": 0.0,
                "change_amt": 0.0,
                "turnover": 0.0,
                "f62": 0.0,
                "f63": 0.0,
                "f64": 0.0,
            }
            records.append(r)
        return records
    except Exception as e:
        print(f"Fetch failed: {e}")
        return []
    finally:
        client.close()

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
    parser = argparse.ArgumentParser(description="Fetch Market Data via Mootdx (High-Depth)")
    parser.add_argument("--symbols", type=str, default="512890,510300,510500", help="Comma separated symbols")
    parser.add_argument("--market", type=str, default="1", help="Default Market ID (1=SH, 0=SZ)")
    parser.add_argument("--count", type=int, default=4000, help="Number of records to fetch (e.g. 25000 for 100 days)")
    args = parser.parse_args()

    symbols = args.symbols.split(",")
    market = int(args.market)
    count = args.count

    init_db()
    
    for symbol in symbols:
        symbol = symbol.strip()
        if not symbol: continue
        
        print(f"\n{'='*50}")
        print(f"Processing {symbol} (Market: {market}) via Mootdx backend...")
        print(f"{'='*50}")

        # Fetch 1 min data (freq=8) - MOST CRITICAL
        records_1m = fetch_data_mootdx(symbol, market, 8, count)
        save_to_db(records_1m, "klines_1m")

        # Fetch 5 min data (freq=0)
        records_5m = fetch_data_mootdx(symbol, market, 0, count)
        save_to_db(records_5m, "klines_5m")

        # Fetch Daily data (freq=9)
        records_day = fetch_data_mootdx(symbol, market, 9, count)
        save_to_db(records_day, "klines_daily")
        
    print("\nDONE: All market data ingestion tasks completed.")

if __name__ == "__main__":
    main()
