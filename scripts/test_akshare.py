import akshare as ak
import pandas as pd

symbol = "512890"

print("--- Testing fund_etf_hist_min_em ---")
try:
    df1 = ak.fund_etf_hist_min_em(symbol=symbol, period='1', adjust='')
    print(df1.head())
except Exception as e:
    print(e)

print("\n--- Testing stock_zh_a_hist_min_em ---")
try:
    # Akshare usually takes 'sh512890' or just '512890' for stock functions
    df2 = ak.stock_zh_a_hist_min_em(symbol=symbol, period='1', adjust='')
    print(df2.head())
except Exception as e:
    print(e)
