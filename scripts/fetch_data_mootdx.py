import sqlite3
import argparse
import time
from pathlib import Path
from mootdx.quotes import Quotes
import pandas as pd
import sys

# Configuration
DB_PATH = (Path(__file__).parent / "../data/market.db").resolve()

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Schema check/creation (omitted for brevity, same as existing)
    conn.commit()
    conn.close()

def get_client_with_retry(max_retries=5):
    """带重试的连接通达信服务器逻辑"""
    for i in range(max_retries):
        try:
            print(f"  正在连接通达信服务器 (第 {i+1} 次尝试)...")
            client = Quotes.factory(market='std')
            return client
        except Exception as e:
            print(f"  连接失败: {e}，等待 3 秒后重试...")
            time.sleep(3)
    return None

def fetch_data_mootdx(symbol, market, frequency, count=800, since_ts="1970-01-01 00:00:00"):
    client = get_client_with_retry()
    if not client:
        print(f"CRITICAL: 无法连接至通达信服务器，跳过 {symbol}")
        return []

    try:
        freq_name = "日线" if frequency == 9 else ("5分钟" if frequency == 0 else "1分钟")
        print(f"  >>> 开始抓取 {symbol} 的 {freq_name} 数据 (增量模式, since={since_ts})...")
        
        all_df = []
        chunk_size = 800
        total_fetched = 0
        
        for i in range(0, count, chunk_size):
            current_count = min(chunk_size, count - i)
            df = client.bars(symbol=symbol, frequency=frequency, start=i, offset=current_count)
            
            if df is None or df.empty:
                print(f"    已经没有更多历史数据。")
                break
            
            df = df.sort_index()
            ts_format = '%Y-%m-%d' if frequency == 9 else '%Y-%m-%d %H:%M'
            
            chunk_oldest_str = df.index[0].strftime(ts_format)
            
            # 进度打印
            print(f"    进度: 已回溯至 {chunk_oldest_str}，本批获取 {len(df)} 条...")

            if chunk_oldest_str <= since_ts:
                df_filtered = df[df.index.map(lambda x: x.strftime(ts_format)) >= since_ts]
                if not df_filtered.empty:
                    all_df.append(df_filtered)
                    total_fetched += len(df_filtered)
                break
            else:
                all_df.append(df)
                total_fetched += len(df)

            if len(df) < current_count: break
            time.sleep(0.2) # 规避频率限制
        
        if not all_df: return []
            
        final_df = pd.concat(all_df).sort_index()
        records = []
        for index, row in final_df.iterrows():
            records.append({
                "symbol": symbol, "timestamp": index.strftime(ts_format),
                "open": float(row['open']), "close": float(row['close']),
                "high": float(row['high']), "low": float(row['low']),
                "volume": int(row['vol']), "amount": float(row['amount']) if 'amount' in row else 0.0,
                "amplitude": 0.0, "change_pct": 0.0, "change_amt": 0.0, "turnover": 0.0,
                "f62": 0.0, "f63": 0.0, "f64": 0.0,
            })
        return records
    except Exception as e:
        print(f"抓取失败: {e}")
        return []
    finally:
        try: client.close()
        except: pass

def save_to_db(records, table_name):
    if not records: return
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    tuples = [(r["symbol"], r["timestamp"], r["open"], r["close"], r["high"], r["low"], 
               r["volume"], r["amount"], r["amplitude"], r["change_pct"], 
               r["change_amt"], r["turnover"], r["f62"], r["f63"], r["f64"]) for r in records]
    c.executemany(f'INSERT OR REPLACE INTO {table_name} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', tuples)
    conn.commit()
    conn.close()
    print(f"  [DB] 成功写入 {len(records)} 条记录到 {table_name}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", required=True)
    parser.add_argument("--count", type=int, default=800)
    args = parser.parse_args()

    for symbol in args.symbols.split(","):
        symbol = symbol.strip()
        print(f"\n{'='*60}")
        print(f"正在处理 A股: {symbol}")
        print(f"{'='*60}")
        
        # 获取各周期的最新时间戳
        def get_last(table):
            try:
                conn = sqlite3.connect(DB_PATH)
                res = conn.execute(f"SELECT MAX(timestamp) FROM {table} WHERE symbol=?", (symbol,)).fetchone()[0]
                conn.close()
                return res if res else "1970-01-01 00:00"
            except: return "1970-01-01 00:00"

        # 分周期抓取
        for freq, table in [(9, "klines_daily"), (0, "klines_5m"), (8, "klines_1m")]:
            recs = fetch_data_mootdx(symbol, 0, freq, args.count, since_ts=get_last(table))
            save_to_db(recs, table)
            
    print("\nDONE: A股任务完成。")

if __name__ == "__main__":
    main()
