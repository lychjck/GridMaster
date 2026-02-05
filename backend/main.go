package main

import (
	"log"
	"net/http"
	"path/filepath"
	"sort"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Kline matches the schema in data/market.db
var DB *gorm.DB

type Kline struct {
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
	// Extra fields if needed, but JSON usually ignores if we don't map them or just keep standard
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

	r.GET("/api/dates", func(c *gin.Context) {
		var dates []string
		// Get distinct dates from both tables
		// Union distinct
		err := DB.Raw(`
			SELECT DISTINCT substr(timestamp, 1, 10) as date FROM klines_5m
			UNION
			SELECT DISTINCT substr(timestamp, 1, 10) as date FROM klines_1m
			ORDER BY date ASC
		`).Scan(&dates).Error

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": dates})
	})

	r.GET("/api/klines", func(c *gin.Context) {
		dateParam := c.Query("date") // Optional date filter

		var klines5m, klines1m []Kline

		// 1. Fetch data (filtered if date provided)
		query5m := DB.Table("klines_5m")
		query1m := DB.Table("klines_1m")

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
		var dailyKlines []Kline

		query := DB.Table("klines_daily").Order("timestamp asc")
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
