#!/usr/bin/env python3
import sys
import json
import sqlite3
from pathlib import Path

DB_PATH = (Path(__file__).parent / "../data/market.db").resolve()

def get_name_from_db(symbol):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM symbols WHERE symbol = ?", (symbol,))
        result = cursor.fetchone()
        conn.close()
        if result and result[0] and result[0] != symbol:
            return result[0]
    except:
        pass
    return None

def get_name_from_mootdx(symbol):
    try:
        from mootdx.quotes import Quotes
        client = Quotes.factory(market='std')
        data = client.quotes(symbol=symbol)
        
        if data is not None and not data.empty:
            name = data.iloc[0].get('name', None)
            if name:
                client.close()
                return name
        
        stocks = client.stock_all()
        if stocks is not None and not stocks.empty:
            stock_info = stocks[stocks['code'] == symbol]
            if not stock_info.empty:
                name = stock_info.iloc[0].get('name', None)
                client.close()
                if name:
                    return name
        
        client.close()
    except Exception as e:
        print(f"Error fetching from mootdx: {e}", file=sys.stderr)
    
    return None

def save_to_db(symbol, name):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO symbols (symbol, name, market) VALUES (?, ?, ?)",
            (symbol, name, 0)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error saving to db: {e}", file=sys.stderr)

def get_market_from_symbol(symbol):
    if len(symbol) == 6:
        if symbol[0] == '6':
            return 1
        return 0
    return 1

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing symbol argument"}))
        sys.exit(1)
    
    symbol = sys.argv[1].strip()
    name = get_name_from_db(symbol)
    
    if not name:
        name = get_name_from_mootdx(symbol)
    
    if not name:
        name = symbol
    
    if name != symbol:
        save_to_db(symbol, name)
    
    result = {
        "symbol": symbol,
        "name": name,
        "market": get_market_from_symbol(symbol)
    }
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
