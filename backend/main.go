package main

import (
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"sort"

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

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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

		// Trigger Python Script Asynchronously
		go func(symbol string) {
			cmd := exec.Command("uv", "run", "scripts/fetch_data_mootdx.py", "--symbols", symbol, "--count", "800")
			cmd.Dir = "../" // Scripts are in ../scripts relative to backend binary if running from backend dir?
			// Wait, we run backend from root usually or backend dir.
			// User runs `go run .` in `backend`. script is in `scripts`. root is `..`.
			// So command should be `uv run scripts/fetch_data_mootdx.py` from root?
			// Let's assume content root. If running from backend folder:
			cmd.Dir = ".."
			// Output capturing for debug
			out, err := cmd.CombinedOutput()
			if err != nil {
				log.Printf("Error fetching data for %s: %v\nOutput: %s", symbol, err, string(out))
			} else {
				log.Printf("Successfully fetched data for %s", symbol)
			}
		}(req.Symbol)

		c.JSON(http.StatusAccepted, gin.H{"message": "Data fetch started", "symbol": req.Symbol})
	})

	// POST /api/refresh - Trigger manual data refresh
	r.POST("/api/refresh", func(c *gin.Context) {
		var req AddSymbolRequest // Reuse struct or create new one if needed only for symbol
		// If reusing, json key is "symbol".
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		go func(symbol string) {
			// Reuse the same script logic
			// Using --force is NOT recommended for refresh as we want incremental.
			// So just call it normally, it has smart stitching.
			cmd := exec.Command("uv", "run", "scripts/fetch_data_mootdx.py", "--symbols", symbol, "--count", "800")
			cmd.Dir = ".."
			out, err := cmd.CombinedOutput()
			if err != nil {
				log.Printf("Error refreshing data for %s: %v\nOutput: %s", symbol, err, string(out))
			} else {
				log.Printf("Successfully refreshed data for %s", symbol)
			}
		}(req.Symbol)

		c.JSON(http.StatusOK, gin.H{"message": "Refresh started", "symbol": req.Symbol})
	})

	r.GET("/api/dates", func(c *gin.Context) {
		symbol := c.Query("symbol")
		var dates []string

		// 改为从分时线表中获取日期，确保有数据可画图
		query := `
			SELECT DISTINCT substr(timestamp, 1, 10) as date 
			FROM (
				SELECT timestamp, symbol FROM klines_1m
				UNION
				SELECT timestamp, symbol FROM klines_5m
			)
		`
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
		dateParam := c.Query("date") // Optional date filter
		symbol := c.Query("symbol")
		if symbol == "" {
			symbol = "512890" // Default
		}

		var klines5m, klines1m []Kline

		// 1. Fetch data (filtered if date provided)
		query5m := DB.Table("klines_5m").Where("symbol = ?", symbol)
		query1m := DB.Table("klines_1m").Where("symbol = ?", symbol)

		if dateParam != "" {
			query5m = query5m.Where("timestamp LIKE ?", dateParam+"%")
			query1m = query1m.Where("timestamp LIKE ?", dateParam+"%")
		}

		if err := query5m.Find(&klines5m).Error; err != nil {
			log.Println("Error fetching 5m:", err)
		}
		if err := query1m.Find(&klines1m).Error; err != nil {
			log.Println("Error fetching 1m:", err)
		}

		// 2. Identification of dates that have 1m data (Logic simplifed if filtered by date)
		datesWith1m := make(map[string]bool)
		for _, k := range klines1m {
			if len(k.Timestamp) >= 10 {
				date := k.Timestamp[:10]
				datesWith1m[date] = true
			}
		}

		// 3. Merge: Use 1m if available, otherwise 5m
		var finalData []Kline

		// Add all 1m data
		finalData = append(finalData, klines1m...)

		// Add 5m data ONLY if that date doesn't exist in 1m
		for _, k := range klines5m {
			if len(k.Timestamp) >= 10 {
				date := k.Timestamp[:10]
				if _, has1m := datesWith1m[date]; !has1m {
					finalData = append(finalData, k)
				}
			}
		}

		// 4. Sort by timestamp
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
			query = query.Where("timestamp LIKE ?", dateParam+"%")
		}

		if err := query.Find(&dailyKlines).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": dailyKlines})
	})

	r.Run(":8080")
}
