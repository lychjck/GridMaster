"""
港股数据获取脚本
数据源: 东方财富港股 API

用法:
    python3 scripts/fetch_hk_data.py --symbol 00700
    python3 scripts/fetch_hk_data.py --symbol 03690 --periods 5m 1m daily
"""

import requests
import sqlite3
import argparse
from pathlib import Path

DB_PATH = (Path(__file__).parent / "../data/market.db").resolve()
URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
UT_TOKEN = "7eea3edcaed734bea9cbfc24409ed989"
HK_MARKET = "116"

PERIOD_MAP = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "60m": "60",
    "daily": "101",
    "weekly": "102",
    "monthly": "103",
}

TABLE_MAP = {
    "1m": "hk_klines_1m",
    "5m": "hk_klines_5m",
    "15m": "hk_klines_15m",
    "30m": "hk_klines_30m",
    "60m": "hk_klines_60m",
    "daily": "hk_klines_daily",
    "weekly": "hk_klines_weekly",
    "monthly": "hk_klines_monthly",
}


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()

        create_sql = """
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
                PRIMARY KEY (symbol, timestamp)
            )
        """

        for table_name in TABLE_MAP.values():
            c.execute(f"CREATE TABLE IF NOT EXISTS {table_name} {create_sql}")

        conn.commit()
        print(f"Database initialized at {DB_PATH}")
    except Exception as e:
        print(f"[DB错误] init_db失败: {e}")
    finally:
        if conn: conn.close()


def fetch_kline(symbol: str, period: str = "5m") -> list[dict]:
    klt = PERIOD_MAP.get(period)
    if not klt:
        print(f"Unsupported period: {period}")
        return []

    symbol_padded = symbol.zfill(5)
    secid = f"{HK_MARKET}.{symbol_padded}"

    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": klt,
        "fqt": "0",
        "ut": UT_TOKEN,
        "beg": "0",
        "end": "20500000",
    }

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": "https://quote.eastmoney.com/",
    }

    try:
        print(f"Fetching {period} data for HK.{symbol} ({secid})...")
        res = requests.get(URL, params=params, headers=headers, timeout=10)
        data = res.json()

        if data.get("rc") != 0:
            print(f"API Error: {data.get('msg')}")
            return []

        if not data.get("data") or not data["data"].get("klines"):
            print(f"No data received for HK.{symbol}")
            return []

        klines = data["data"]["klines"]
        print(f"Received {len(klines)} records")

        records = []
        for k in klines:
            parts = k.split(",")
            if len(parts) < 6:
                continue

            record = {
                "symbol": f"HK.{symbol}",
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
            }
            records.append(record)

        return records

    except Exception as e:
        print(f"Fetch failed: {e}")
        return []


def save_to_db(records: list[dict], table_name: str):
    if not records:
        return

    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()

        tuples = [
            (
                r["symbol"],
                r["timestamp"],
                r["open"],
                r["close"],
                r["high"],
                r["low"],
                r["volume"],
                r["amount"],
                r["amplitude"],
                r["change_pct"],
                r["change_amt"],
                r["turnover"],
            )
            for r in records
        ]

        c.executemany(
            f"""
            INSERT OR REPLACE INTO {table_name}
            (symbol, timestamp, open, close, high, low, volume, amount, amplitude, change_pct, change_amt, turnover)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            tuples,
        )
        conn.commit()
        print(f"Saved {len(records)} records to {table_name}")
    except Exception as e:
        print(f"[DB错误] save_to_db失败: {e}")
    finally:
        if conn: conn.close()


def main():
    parser = argparse.ArgumentParser(description="港股数据获取 (HK Stock Data Fetcher)")
    parser.add_argument("--symbol", type=str, required=True, help="港股代码，如 00700")
    parser.add_argument(
        "--periods",
        nargs="+",
        default=["5m", "1m", "daily"],
        choices=list(PERIOD_MAP.keys()),
        help="要获取的周期",
    )
    args = parser.parse_args()

    symbol = args.symbol.zfill(5)
    periods = args.periods

    init_db()

    print(f"\n{'='*50}")
    print(f"Processing HK.{symbol}")
    print(f"Periods: {', '.join(periods)}")
    print(f"{'='*50}\n")

    for period in periods:
        table_name = TABLE_MAP[period]
        records = fetch_kline(symbol, period)
        save_to_db(records, table_name)
        print()

    print("Done!")


if __name__ == "__main__":
    main()
