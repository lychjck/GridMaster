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
    
    # Symbols Meta Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS symbols (
            symbol TEXT PRIMARY KEY,
            name TEXT,
            market INTEGER
        )
    ''')
    
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

def get_latest_timestamp(symbol, table_name):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute(f"SELECT MAX(timestamp) FROM {table_name} WHERE symbol=?", (symbol,))
        row = c.fetchone()
        conn.close()
        return row[0] if row and row[0] else "1970-01-01 00:00:00"
    except Exception as e:
        print(f"Warning: Could not get latest timestamp from {table_name}: {e}")
        return "1970-01-01 00:00:00"

def fetch_data_mootdx(symbol, market, frequency, count=800, since_ts="1970-01-01 00:00:00"):
    """
    frequency: 9=daily, 8=1m, 0=5m
    market: 1=SH, 0=SZ
    since_ts: stop fetching if we encounter data older or equal to this timestamp
    """
    client = Quotes.factory(market='std')
    try:
        print(f"Fetching freq={frequency} records for {symbol} (Market: {market}) from TDX...")
        print(f"  Smart Mode: Stop if timestamp <= {since_ts}")
        
        all_df = []
        chunk_size = 800
        total_fetched = 0
        
        for i in range(0, count, chunk_size):
            current_count = min(chunk_size, count - i)
            # print(f"  Requesting chunk {i//chunk_size + 1} (start={i}, count={current_count})...")
            df = client.bars(symbol=symbol, frequency=frequency, start=i, offset=current_count)
            
            if df is None or df.empty:
                break
            
            # Sort to ensure we check time accurately (mootdx usually returns desc or asc depending on source, but index is datetime)
            df = df.sort_index()
            
            # Data format check
            # 日线使用 YYYY-MM-DD，分钟线使用 YYYY-MM-DD HH:MM
            ts_format = '%Y-%m-%d' if frequency == 9 else '%Y-%m-%d %H:%M'
            
            # Smart Stitching Check
            # df.index is DatetimeIndex
            start_time = df.index[0].strftime(ts_format)
            end_time = df.index[-1].strftime(ts_format)
            
            # print(f"    Chunk range: {start_time} -> {end_time}")
            
            # If the OLDEST record in this chunk (df.index[0]) is NEWER than since_ts, keep it all.
            # If the OLDEST record is OLDER or EQUAL to since_ts, we found the overlap.
            
            # However, mootdx bars(offset=0) returns NEWEST data. 
            # So start=0 is newest. start=800 is older.
            # If we iterate i=0, 800... we are going BACKWARDS in time.
            # So df.index[0] is the OLDEST in this chunk? 
            # Wait, df.sort_index() makes it ASCENDING. 
            # So df.index[0] is the OLDEST in this chunk.
            # df.index[-1] is the NEWEST in this chunk.
            
            # We are going backwards in chunks.
            # Chunk 1: [Today 09:30 ... Today 15:00] (Checking...)
            # We want to keep records where ts > since_ts.
            
            # Filter matches
            # Since index is Timestamp, we parse since_ts to Timestamp for comparison or compare strings (YYYY-MM-DD HH:MM sorts naturally)
            # String comparison works for ISO-like formats.
            
            chunk_oldest_str = df.index[0].strftime(ts_format)
            
            if chunk_oldest_str <= since_ts:
                print(f"  [Smart Stitching] Found overlap: Chunk oldest {chunk_oldest_str} <= DB latest {since_ts}.")
                # Filter this chunk to only keep new data OR update existing latest record
                # Changed > to >= to allow updating the latest record (e.g. today's daily bar which changes throughout the day)
                df_filtered = df[df.index.map(lambda x: x.strftime(ts_format)) >= since_ts]
                
                if not df_filtered.empty:
                    all_df.append(df_filtered)
                    total_fetched += len(df_filtered)
                
                print(f"  [Smart Stitching] Stopping fetch. (Saved {len(df_filtered)} from this boundary chunk)")
                break
            else:
                # Whole chunk is new
                all_df.append(df)
                total_fetched += len(df)
                print(f"  Saved chunk {i//chunk_size + 1} ({len(df)} rows). Oldest: {chunk_oldest_str}")

            if len(df) < current_count: # No more data from server
                break
        
        if not all_df:
            print(f"No new data needed for {symbol}. (Database is up to date)")
            return []
            
        final_df = pd.concat(all_df).sort_index()
        print(f"Total new records to save: {len(final_df)}")
        
        records = []
        # ts_format defined above
        
        for index, row in final_df.iterrows():
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

def save_symbol_meta(symbol, market, name=None):
    if not name:
        name = symbol # Default to symbol if name not provided
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        c.execute('INSERT OR REPLACE INTO symbols (symbol, name, market) VALUES (?, ?, ?)', (symbol, name, market))
        conn.commit()
    except Exception as e:
        print(f"Warning: Could not save symbol meta: {e}")
    finally:
        conn.close()

def infer_market(symbol):
    """
    Infer market ID from symbol.
    SH (1): 60xxxx, 68xxxx, 51xxxx (ETF SH), 58xxxx
    SZ (0): 00xxxx, 30xxxx, 15xxxx (ETF SZ)
    Default to 1 (SH) if unknown
    """
    if symbol.startswith(('60', '68', '51', '58')):
        return 1
    elif symbol.startswith(('00', '30', '15')):
        return 0
    return 1 # Fallback

import urllib.request

def get_stock_name(symbol, market):
    """
    Fetch stock name via Tencent Interface (qt.gtimg.cn)
    market: 1=SH, 0=SZ
    """
    try:
        prefix = "sh" if market == 1 else "sz"
        url = f"http://qt.gtimg.cn/q={prefix}{symbol}"
        with urllib.request.urlopen(url, timeout=3) as response:
            data = response.read().decode('gbk') # Tensor returns GBK
            # Format: v_sh512890="1~红利低波~..."
            if data and '~' in data:
                parts = data.split('~')
                if len(parts) > 2:
                    return parts[1]
    except Exception as e:
        print(f"Warning: Could not fetch name for {symbol}: {e}")
    return symbol # Fallback

def initialize_default_symbols():
    defaults = [
        ("512890", 1, "红利低波"),
        ("510300", 1, "沪深300"),
        ("159915", 0, "创业板指")
    ]
    for s, m, n in defaults:
        save_symbol_meta(s, m, n)

from datetime import datetime, timedelta

def get_adjusted_timestamp(symbol, table_name, lookback_days=0):
    """
    Get the latest timestamp and subtract N days to allow 'healing' of recent data.
    """
    latest = get_latest_timestamp(symbol, table_name)
    if latest == "1970-01-01 00:00:00" or latest == "1970-01-01":
        return latest
    
    try:
        # Detect format
        fmt = '%Y-%m-%d %H:%M' if ' ' in latest else '%Y-%m-%d'
        dt = datetime.strptime(latest, fmt)
        if lookback_days > 0:
            dt = dt - timedelta(days=lookback_days)
        return dt.strftime(fmt)
    except Exception as e:
        print(f"Warning: Could not adjust timestamp {latest}: {e}")
        return latest

def main():
    parser = argparse.ArgumentParser(description="Fetch Market Data via Mootdx (Smart Increment)")
    parser.add_argument("--symbols", type=str, default="512890,510300,510500", help="Comma separated symbols")
    parser.add_argument("--market", type=int, default=-1, help="Market ID (1=SH, 0=SZ). -1=Auto-detect")
    parser.add_argument("--count", type=int, default=40000, help="Max records for safety limit")
    parser.add_argument("--force", action="store_true", help="Disable smart stitching and force fetch full count")
    parser.add_argument("--lookback", type=int, default=0, help="Days to look back and re-sync for intraday data")
    args = parser.parse_args()

    symbols_arg = args.symbols.split(",")
    count = args.count

    init_db()
    initialize_default_symbols() # Ensure defaults exist
    
    for symbol in symbols_arg:
        symbol = symbol.strip()
        if not symbol: continue
        
        # Auto detect market if not specified
        market = args.market
        if market == -1:
            market = infer_market(symbol)
        
        # Fetch Name
        name = get_stock_name(symbol, market)
        
        # Save Metadata first
        save_symbol_meta(symbol, market, name)
        
        print(f"\n{'='*50}")
        print(f"Processing {symbol} (Market: {market}) via Mootdx backend...")
        print(f"{'='*50}")

        # Fetch 1 min data (freq=8)
        table_1m = "klines_1m"
        latest_1m = "1970-01-01 00:00:00" if args.force else get_adjusted_timestamp(symbol, table_1m, args.lookback)
        records_1m = fetch_data_mootdx(symbol, market, 8, count, since_ts=latest_1m)
        save_to_db(records_1m, table_1m)

        # Fetch 5 min data (freq=0)
        table_5m = "klines_5m"
        latest_5m = "1970-01-01 00:00:00" if args.force else get_adjusted_timestamp(symbol, table_5m, args.lookback)
        records_5m = fetch_data_mootdx(symbol, market, 0, count, since_ts=latest_5m)
        save_to_db(records_5m, table_5m)

        # Fetch Daily data (freq=9)
        # Default 7 days lookback for daily bars to ensure historical errors are fixed
        table_day = "klines_daily"
        latest_day = "1970-01-01" if args.force else get_adjusted_timestamp(symbol, table_day, max(7, args.lookback))
        records_day = fetch_data_mootdx(symbol, market, 9, count, since_ts=latest_day)
        save_to_db(records_day, table_day)
        
    print("\nDONE: All market data ingestion tasks completed.")

if __name__ == "__main__":
    main()
