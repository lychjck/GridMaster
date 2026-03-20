package main

import (
	"bufio"
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

		// Check if already exists
		var exists Symbol
		if err := DB.First(&exists, "symbol = ?", req.Symbol).Error; err == nil {
			c.JSON(http.StatusOK, gin.H{"message": "Symbol already exists", "data": exists})
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
			} else {
				cmd = exec.Command("uv", "run", "scripts/fetch_data_mootdx.py", "--symbols", s, "--count", "800")
			}
			cmd.Dir = ".."

			// Capture stdout and stderr
			stdout, _ := cmd.StdoutPipe()
			cmd.Stderr = cmd.Stdout
			if err := cmd.Start(); err != nil {
				log.Printf("Failed to start script for %s: %v", s, err)
				return
			}

			// Stream output line by line
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				log.Printf("[%s LOG] %s", s, scanner.Text())
			}

			if err := cmd.Wait(); err != nil {
				log.Printf("Script finished with error for %s: %v", s, err)
			} else {
				log.Printf("Successfully completed all tasks for %s", s)
			}
		}(req.Symbol)

		c.JSON(http.StatusAccepted, gin.H{"message": "Data fetch started in background", "symbol": req.Symbol})
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
			} else {
				cmd = exec.Command("uv", "run", "scripts/fetch_data_mootdx.py", "--symbols", s, "--count", "800")
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

		// 优化方案：直接从日线表获取日期，速度极快
		// 因为我们同步时保证了 1d, 5m, 1m 数据的一致性
		query := `SELECT DISTINCT timestamp as date FROM klines_daily`
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

		var klines5m, klines1m []Kline

		// 1. 先探测 5m 表（数据量小，速度快）
		query5m := DB.Table("klines_5m").Where("symbol = ?", symbol)
		if dateParam != "" {
			query5m = query5m.Where("timestamp >= ? AND timestamp < ?", dateParam, dateParam+" 24:00")
		}
		if err := query5m.Find(&klines5m).Error; err != nil {
			log.Println("Error fetching 5m:", err)
		}

		// 2. 如果 5m 都没有数据，说明这天肯定没拉到，直接返回空，不要去碰巨大的 1m 表
		if len(klines5m) == 0 {
			c.JSON(http.StatusOK, gin.H{"data": []Kline{}})
			return
		}

		// 3. 5m 有数据，再去尝试加载更高精度的 1m 表
		query1m := DB.Table("klines_1m").Where("symbol = ?", symbol)
		if dateParam != "" {
			query1m = query1m.Where("timestamp >= ? AND timestamp < ?", dateParam, dateParam+" 24:00")
		}
		if err := query1m.Find(&klines1m).Error; err != nil {
			log.Println("Error fetching 1m:", err)
		}

		// 4. 合并逻辑：如果有 1m 则用 1m，否则降级回 5m
		// (以下保持原有合并逻辑)...
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

		var dailyKlines []Kline

		query := DB.Table("klines_daily").Where("symbol = ?", symbol).Order("timestamp asc")
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
					// 跳过币安和黄金
					if strings.HasSuffix(strings.ToUpper(s.Symbol), "USDT") || strings.ToUpper(s.Symbol) == "XAU" {
						continue
					}

					log.Printf("A-Stock Refresh: Updating %s...\n", s.Symbol)
					cmd := exec.Command("uv", "run", "scripts/fetch_data_mootdx.py", "--symbols", s.Symbol, "--count", "800")
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
