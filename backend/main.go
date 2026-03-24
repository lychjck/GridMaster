package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite" // Pure Go SQLite driver
	"gorm.io/gorm"
)

// Kline matches the schema in data/market.db
var DB *gorm.DB

type Kline struct {
	Symbol    string  `gorm:"primaryKey" json:"symbol"`
	Timestamp string  `gorm:"primaryKey" json:"timestamp"`
	Open      float64 `json:"open"`
	Close     float64 `json:"close"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Volume    int64   `json:"volume"`
	Amount    float64 `json:"amount"`
	Amplitude float64 `json:"amplitude"`
	ChangePct float64 `json:"change_pct"`
	ChangeAmt float64 `json:"change_amt"`
	Turnover  float64 `json:"turnover"`
}

type Symbol struct {
	Symbol string `gorm:"primaryKey" json:"symbol"`
	Name   string `json:"name"`
	Market int    `json:"market"`
}

type AddSymbolRequest struct {
	Symbol string `json:"symbol" binding:"required"`
}

func main() {
	dbPath := "../data/market.db"
	absPath, _ := filepath.Abs(dbPath)
	log.Printf("Connecting to DB at: %s", absPath)

	var err error
	DB, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		log.Fatal("failed to connect database:", err)
	}

	// Auto Migrate
	DB.AutoMigrate(&Symbol{})

	// Create Indexes
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_1m_symbol_ts ON klines_1m(symbol, timestamp)")
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_5m_symbol_ts ON klines_5m(symbol, timestamp)")
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_daily_symbol_ts ON klines_daily(symbol, timestamp)")
	log.Println("Database indexes ensured.")

	// Start Background Refresh Tasks
	go startAStockRefresh()
	go startBinanceRefresh()
	go startHKStockRefresh()

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Register Simulation
	RegisterSimulationRoutes(r)

	// GET /api/symbols - Get list of supported symbols
	r.GET("/api/symbols", func(c *gin.Context) {
		var symbols []Symbol
		if err := DB.Order("symbol asc").Find(&symbols).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": symbols})
	})

	// DELETE /api/symbols/:symbol - Remove a symbol and its data
	r.DELETE("/api/symbols/:symbol", func(c *gin.Context) {
		symbol := c.Param("symbol")
		if symbol == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Symbol is required"})
			return
		}

		// Delete from symbols table
		if err := DB.Delete(&Symbol{}, "symbol = ?", symbol).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Clean up kline data
		tables := []string{"klines_1m", "klines_5m", "klines_daily"}
		for _, table := range tables {
			if err := DB.Table(table).Where("symbol = ?", symbol).Delete(nil).Error; err != nil {
				log.Printf("Warning: Failed to clean up table %s for symbol %s: %v", table, symbol, err)
			}
		}

		c.JSON(http.StatusOK, gin.H{"message": "Symbol and data removed successfully", "symbol": symbol})
	})

	// POST /api/symbols - Add new symbol (trigger python fetch)
	r.POST("/api/symbols", func(c *gin.Context) {
		var req AddSymbolRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		symbol := req.Symbol
		var symbolRecord Symbol

		// Check if already exists
		if err := DB.First(&symbolRecord, "symbol = ?", symbol).Error; err == nil {
			c.JSON(http.StatusOK, gin.H{"message": "Symbol already exists", "data": symbolRecord})
			return
		}

		symbolUpper := strings.ToUpper(symbol)
		var market int
		if symbolUpper == "XAU" {
			market = 100
		} else if strings.HasSuffix(symbolUpper, "USDT") {
			market = 100
		} else if isHKSymbol(symbol) {
			market = 116
		} else {
			market = getMarketFromSymbol(symbol)
		}

		symbolRecord = Symbol{Symbol: symbol, Name: symbol, Market: market}

		if err := DB.Create(&symbolRecord).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create symbol: " + err.Error()})
			return
		}

		c.JSON(http.StatusAccepted, gin.H{"message": "Data fetch started in background", "data": symbolRecord})

		go func(s string) {
			var realName string
			if symbolUpper == "XAU" {
				realName = "黄金"
			} else if strings.HasSuffix(symbolUpper, "USDT") {
				realName = symbolUpper
			} else if isHKSymbol(s) {
				realName = getHKStockName(s)
			} else {
				realName = getAStockName(s)
			}

			if realName != s && realName != "" {
				if err := DB.Model(&Symbol{}).Where("symbol = ?", s).Update("name", realName).Error; err != nil {
					log.Printf("Failed to update name for %s: %v", s, err)
				} else {
					log.Printf("Updated name for %s: %s", s, realName)
				}
			}

			var cmd *exec.Cmd
			if symbolUpper == "XAU" {
				cmd = exec.Command("uv", "run", "scripts/fetch_gold_sina.py")
			} else if strings.HasSuffix(symbolUpper, "USDT") {
				cmd = exec.Command("uv", "run", "scripts/fetch_binance.py", "--symbols", symbolUpper)
			} else if isHKSymbol(s) {
				cmd = exec.Command("uv", "run", "scripts/fetch_hk_data.py", "--symbol", s)
			} else {
				cmd = exec.Command("uv", "run", "scripts/fetch_data_mootdx.py", "--symbols", s, "--count", "999999")
			}
			cmd.Dir = ".."

			stdout, _ := cmd.StdoutPipe()
			cmd.Stderr = cmd.Stdout
			if err := cmd.Start(); err != nil {
				log.Printf("Failed to start script for %s: %v", s, err)
				return
			}

			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				log.Printf("[%s LOG] %s", s, scanner.Text())
			}

			if err := cmd.Wait(); err != nil {
				log.Printf("Script finished with error for %s: %v", s, err)
			} else {
				log.Printf("Successfully completed all tasks for %s", s)
			}
		}(symbol)
	})

	// POST /api/refresh - Trigger manual data refresh
	r.POST("/api/refresh", func(c *gin.Context) {
		var req AddSymbolRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Trigger Python Script Asynchronously with Real-time Logging
		go func(s string) {
			var cmd *exec.Cmd
			symbolUpper := strings.ToUpper(s)
			if symbolUpper == "XAU" {
				cmd = exec.Command("uv", "run", "scripts/fetch_gold_sina.py")
			} else if strings.HasSuffix(symbolUpper, "USDT") {
				cmd = exec.Command("uv", "run", "scripts/fetch_binance.py", "--symbols", symbolUpper)
			} else if isHKSymbol(s) {
				cmd = exec.Command("uv", "run", "scripts/fetch_hk_data.py", "--symbol", s)
			} else {
				cmd = exec.Command("uv", "run", "scripts/fetch_data_mootdx.py", "--symbols", s, "--count", "999999")
			}
			cmd.Dir = ".."

			stdout, _ := cmd.StdoutPipe()
			cmd.Stderr = cmd.Stdout
			if err := cmd.Start(); err != nil {
				log.Printf("Failed to start refresh script for %s: %v", s, err)
				return
			}

			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				log.Printf("[%s REFRESH] %s", s, scanner.Text())
			}

			if err := cmd.Wait(); err != nil {
				log.Printf("Refresh script finished with error for %s: %v", s, err)
			} else {
				log.Printf("Successfully completed refresh for %s", s)
			}
		}(req.Symbol)

		c.JSON(http.StatusOK, gin.H{"message": "Refresh started in background", "symbol": req.Symbol})
	})

	r.GET("/api/dates", func(c *gin.Context) {
		symbol := c.Query("symbol")
		var dates []string

		dailyTable := "klines_daily"
		if symbol != "" && isHKSymbol(symbol) {
			dailyTable = "hk_klines_daily"
			symbol = "HK." + symbol
		}

		query := fmt.Sprintf(`SELECT DISTINCT timestamp as date FROM %s`, dailyTable)
		var params []interface{}

		if symbol != "" {
			query += ` WHERE symbol = ?`
			params = append(params, symbol)
		}
		query += ` ORDER BY date ASC`

		err := DB.Raw(query, params...).Scan(&dates).Error

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": dates})
	})

	r.GET("/api/klines", func(c *gin.Context) {
		dateParam := c.Query("date")
		symbol := c.Query("symbol")
		if symbol == "" {
			symbol = "512890"
		}

		table5m := "klines_5m"
		table1m := "klines_1m"
		if isHKSymbol(symbol) {
			table5m = "hk_klines_5m"
			table1m = "hk_klines_1m"
			symbol = "HK." + symbol
		}

		var klines5m, klines1m []Kline

		query5m := DB.Table(table5m).Where("symbol = ?", symbol)
		if dateParam != "" {
			query5m = query5m.Where("timestamp >= ? AND timestamp < ?", dateParam, dateParam+" 24:00")
		}
		if err := query5m.Find(&klines5m).Error; err != nil {
			log.Println("Error fetching 5m:", err)
		}

		if len(klines5m) == 0 {
			c.JSON(http.StatusOK, gin.H{"data": []Kline{}})
			return
		}

		query1m := DB.Table(table1m).Where("symbol = ?", symbol)
		if dateParam != "" {
			query1m = query1m.Where("timestamp >= ? AND timestamp < ?", dateParam, dateParam+" 24:00")
		}
		if err := query1m.Find(&klines1m).Error; err != nil {
			log.Println("Error fetching 1m:", err)
		}

		datesWith1m := make(map[string]bool)
		for _, k := range klines1m {
			if len(k.Timestamp) >= 10 {
				date := k.Timestamp[:10]
				datesWith1m[date] = true
			}
		}

		var finalData []Kline
		finalData = append(finalData, klines1m...)

		for _, k := range klines5m {
			if len(k.Timestamp) >= 10 {
				date := k.Timestamp[:10]
				if _, has1m := datesWith1m[date]; !has1m {
					finalData = append(finalData, k)
				}
			}
		}

		sort.Slice(finalData, func(i, j int) bool {
			return finalData[i].Timestamp < finalData[j].Timestamp
		})

		c.JSON(http.StatusOK, gin.H{"data": finalData})
	})

	r.GET("/api/klines/daily", func(c *gin.Context) {
		dateParam := c.Query("date")
		symbol := c.Query("symbol")
		if symbol == "" {
			symbol = "512890"
		}

		dailyTable := "klines_daily"
		if isHKSymbol(symbol) {
			dailyTable = "hk_klines_daily"
			symbol = "HK." + symbol
		}

		var dailyKlines []Kline

		query := DB.Table(dailyTable).Where("symbol = ?", symbol).Order("timestamp asc")
		if dateParam != "" {
			query = query.Where("timestamp >= ? AND timestamp < ?", dateParam, dateParam+" 24:00")
		}

		if err := query.Find(&dailyKlines).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": dailyKlines})
	})

	r.Run(":8080")
}

func isHKSymbol(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) == 0 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(s) <= 5
}

func getHKStockName(symbol string) string {
	names := map[string]string{
		"00700": "腾讯控股",
		"03690": "美团-W",
		"01810": "小米集团-W",
		"09988": "阿里巴巴-SW",
		"09618": "京东集团-SW",
		"02318": "中国平安",
		"00941": "中国移动",
		"00388": "港交所",
		"01299": "友邦保险",
		"00005": "汇丰控股",
	}
	if name, ok := names[symbol]; ok {
		return name
	}
	return "港股" + symbol
}

func getAStockName(symbol string) string {
	cmd := exec.Command("uv", "run", "scripts/get_stock_name.py", symbol)
	cmd.Dir = ".."
	output, err := cmd.Output()
	if err != nil {
		log.Printf("Failed to get stock name for %s: %v", symbol, err)
		return symbol
	}

	var result struct {
		Symbol string `json:"symbol"`
		Name   string `json:"name"`
		Market int    `json:"market"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		log.Printf("Failed to parse stock name response for %s: %v", symbol, err)
		return symbol
	}

	if result.Name != "" {
		return result.Name
	}
	return symbol
}

func getMarketFromSymbol(symbol string) int {
	if len(symbol) == 6 {
		if symbol[0] == '6' {
			return 1
		}
		return 0
	}
	return 1
}

func isTradingTime() bool {
	now := time.Now()
	hour := now.Hour()
	minute := now.Minute()
	weekday := now.Weekday()

	// 周末不交易
	if weekday == time.Saturday || weekday == time.Sunday {
		return false
	}

	// 交易时间：9:30-11:30, 13:00-15:00
	totalMinutes := hour*60 + minute
	morningStart := 9*60 + 30
	morningEnd := 11*60 + 30
	afternoonStart := 13 * 60
	afternoonEnd := 15 * 60

	return (totalMinutes >= morningStart && totalMinutes < morningEnd) ||
		(totalMinutes >= afternoonStart && totalMinutes < afternoonEnd)
}

func startAStockRefresh() {
	log.Println("Starting A-Stock background refresh task (every 5 min during trading hours)...")
	for {
		if isTradingTime() {
			log.Println("A-Stock Refresh: Trading time, scanning symbols...")

			var symbols []Symbol
			if err := DB.Find(&symbols).Error; err != nil {
				log.Printf("A-Stock Refresh: Error fetching symbols: %v\n", err)
			} else {
				for _, s := range symbols {
					// 跳过币安、黄金和港股
					if strings.HasSuffix(strings.ToUpper(s.Symbol), "USDT") || strings.ToUpper(s.Symbol) == "XAU" || isHKSymbol(s.Symbol) {
						continue
					}

					log.Printf("A-Stock Refresh: Updating %s...\n", s.Symbol)
					cmd := exec.Command("uv", "run", "scripts/fetch_data_mootdx.py", "--symbols", s.Symbol, "--count", "999999")
					cmd.Dir = ".."
					out, err := cmd.CombinedOutput()
					if err != nil {
						log.Printf("A-Stock Refresh: Error for %s: %v\nOutput: %s", s.Symbol, err, string(out))
					} else {
						log.Printf("A-Stock Refresh: Success for %s", s.Symbol)
					}
					time.Sleep(5 * time.Second)
				}
			}
		} else {
			log.Println("A-Stock Refresh: Non-trading time, skipping...")
		}

		time.Sleep(5 * time.Minute)
	}
}

func isHKTradingTime() bool {
	now := time.Now()
	hour := now.Hour()
	minute := now.Minute()
	weekday := now.Weekday()

	if weekday == time.Saturday || weekday == time.Sunday {
		return false
	}

	totalMinutes := hour*60 + minute
	morningStart := 9*60 + 30
	morningEnd := 12 * 60
	afternoonStart := 13 * 60
	afternoonEnd := 16 * 60

	return (totalMinutes >= morningStart && totalMinutes < morningEnd) ||
		(totalMinutes >= afternoonStart && totalMinutes < afternoonEnd)
}

func startHKStockRefresh() {
	log.Println("Starting HK-Stock background refresh task (every 5 min during trading hours)...")
	for {
		if isHKTradingTime() {
			log.Println("HK-Stock Refresh: Trading time, scanning symbols...")

			var symbols []Symbol
			if err := DB.Find(&symbols).Error; err != nil {
				log.Printf("HK-Stock Refresh: Error fetching symbols: %v\n", err)
			} else {
				for _, s := range symbols {
					if !isHKSymbol(s.Symbol) {
						continue
					}

					log.Printf("HK-Stock Refresh: Updating %s...\n", s.Symbol)
					cmd := exec.Command("uv", "run", "scripts/fetch_hk_data.py", "--symbol", s.Symbol)
					cmd.Dir = ".."
					out, err := cmd.CombinedOutput()
					if err != nil {
						log.Printf("HK-Stock Refresh: Error for %s: %v\nOutput: %s", s.Symbol, err, string(out))
					} else {
						log.Printf("HK-Stock Refresh: Success for %s", s.Symbol)
					}
					time.Sleep(5 * time.Second)
				}
			}
		} else {
			log.Println("HK-Stock Refresh: Non-trading time, skipping...")
		}

		time.Sleep(5 * time.Minute)
	}
}

func startBinanceRefresh() {
	log.Println("Starting Binance background refresh task (every 1 min)...")
	for {
		var symbols []Symbol
		if err := DB.Find(&symbols).Error; err != nil {
			log.Printf("Binance Refresh: Error fetching symbols: %v\n", err)
		} else {
			for _, s := range symbols {
				if !strings.HasSuffix(strings.ToUpper(s.Symbol), "USDT") {
					continue
				}

				log.Printf("Binance Refresh: Updating %s...\n", s.Symbol)
				cmd := exec.Command("uv", "run", "scripts/fetch_binance.py", "--symbols", s.Symbol)
				cmd.Dir = ".."
				out, err := cmd.CombinedOutput()
				if err != nil {
					log.Printf("Binance Refresh: Error for %s: %v\nOutput: %s", s.Symbol, err, string(out))
				} else {
					log.Printf("Binance Refresh: Success for %s", s.Symbol)
				}
				time.Sleep(2 * time.Second)
			}
		}

		time.Sleep(1 * time.Minute)
	}
}
