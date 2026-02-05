package main

import (
	"math"
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
)

type SimConfig struct {
	StartDate      string  `json:"startDate"`
	BasePrice      float64 `json:"basePrice"`
	GridStep       float64 `json:"gridStep"`       // e.g. 1.0 for 1% OR 0.05 for Price
	GridStepType   string  `json:"gridStepType"`   // "percent" (default) or "absolute"
	CommissionRate float64 `json:"commissionRate"` // e.g. 0.0002
	MinCommission  float64 `json:"minCommission"`  // e.g. 0.2
	AmountPerGrid  float64 `json:"amountPerGrid"`  // Default 100 shares
	UsePenetration bool    `json:"usePenetration"` // New: Strict penetration mode
}

type DailyStat struct {
	Date        string  `json:"date"`
	BuyCount    int     `json:"buyCount"`
	SellCount   int     `json:"sellCount"`
	GrossProfit float64 `json:"grossProfit"` // Realized profit
	Commission  float64 `json:"commission"`
	NetProfit   float64 `json:"netProfit"`
	ClosePrice  float64 `json:"closePrice"`
}

type Trade struct {
	Time   string  `json:"time"`
	Type   string  `json:"type"` // "BUY" | "SELL"
	Price  float64 `json:"price"`
	Amount float64 `json:"amount"`
	Comm   float64 `json:"comm"`
}

type SimResult struct {
	TotalProfit float64     `json:"totalProfit"`
	TotalTx     int         `json:"totalTx"`
	TotalComm   float64     `json:"totalComm"`
	DailyStats  []DailyStat `json:"dailyStats"`
	Trades      []Trade     `json:"trades"`
	ChartData   []Kline     `json:"chartData"`
}

func RegisterSimulationRoutes(r *gin.Engine) {
	r.POST("/api/simulate", runSimulation)
}

func runSimulation(c *gin.Context) {
	var config SimConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Default values
	if config.GridStep <= 0 {
		config.GridStep = 1.0
	}
	if config.AmountPerGrid <= 0 {
		config.AmountPerGrid = 100
	} // Default 100 shares

	// 1. Fetch Data
	// 1. Smart Data Selection
	// Check if we have 1m data covering the requested StartDate
	var first1m Kline
	has1m := false
	if err := DB.Table("klines_1m").Order("timestamp asc").First(&first1m).Error; err == nil {
		if first1m.Timestamp <= config.StartDate {
			has1m = true
		}
	}

	var klines []Kline
	usedTable := "klines_1m" // default

	if !has1m {
		// Fallback to 5m
		usedTable = "klines_5m"
	}

	if err := DB.Table(usedTable).Where("timestamp >= ?", config.StartDate).Order("timestamp asc").Find(&klines).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if len(klines) == 0 {
		c.JSON(http.StatusOK, SimResult{})
		return
	}

	// 2. Simulation State
	// Grid Index: 0 = Base.
	// Level N = BasePrice * (1 + N * Step/100)
	// We track "LastExecutedGridIndex".
	// Initial State: Determined by first price? Or start at 0?
	// Usually start waiting.
	// Let's assume we start with "LastExecIndex" closest to current price.

	firstPrice := klines[0].Open

	// Initial Index Calculation
	var initialIndex int
	var stepValue float64 // either price diff or ratio

	if config.GridStepType == "absolute" {
		// Step is absolute price difference, e.g. 0.01
		stepValue = config.GridStep
		// firstPrice = Base + idx * step
		// idx = (firstPrice - Base) / step
		initialIndex = int(MathRound((firstPrice - config.BasePrice) / stepValue))
	} else {
		// Default to percentage
		stepValue = config.GridStep / 100.0
		// firstPrice = Base * (1 + idx * stepRatio)
		initialIndex = int(MathRound((firstPrice/config.BasePrice - 1) / stepValue))
	}

	lastExecIndex := initialIndex

	// Stats
	dailyStatsMap := make(map[string]*DailyStat)
	var result SimResult

	// Track active grids to calculate profit?
	// In simple grid: Sell at N is matched with Buy at N-1.
	// Buy at N is matched with Sell at N+1? No, buy at N is opening position.
	// Standard Grid:
	// Buy at N -> Hold.
	// If Price rises to N+1 -> Sell (Profit = Base * Step * Amount).
	// If Price falls to N-1 -> Buy another.

	// We assume infinite cash/shares for simulation to calculate theoretical profit.
	// Every "Sell" event generates Realized Profit calculated against the "Buy" at N-1 level.
	// Profit per pair = (Price_Sell - Price_Buy) * Amount - Comm * 2
	// Approximate Price_Sell - Price_Buy ~= Base * Step.

	// Loop
	for _, k := range klines {
		// Use Low and High to trigger
		// Current Grid Interval?

		// Check for Buy (Price Crosses Down)
		// If Low < Grid(lastExecIndex - 1)
		// We might cross multiple grids in one minute? E.g. flash crash.
		// Let's iterate.

		date := k.Timestamp[:10]
		if _, ok := dailyStatsMap[date]; !ok {
			dailyStatsMap[date] = &DailyStat{Date: date}
		}
		stat := dailyStatsMap[date]
		stat.ClosePrice = k.Close // Update close

		// Check Buy Down
		for {
			nextBuyIndex := lastExecIndex - 1
			var nextBuyPrice float64

			if config.GridStepType == "absolute" {
				nextBuyPrice = config.BasePrice + float64(nextBuyIndex)*stepValue
			} else {
				nextBuyPrice = config.BasePrice * (1 + float64(nextBuyIndex)*stepValue)
			}

			// Trigger Check
			triggered := false
			if config.UsePenetration {
				triggered = k.Low < nextBuyPrice // Price MUST break it
			} else {
				triggered = k.Low <= nextBuyPrice // Price only needs to touch it
			}

			if triggered {
				// Trigger Buy
				// Cost
				cost := nextBuyPrice * config.AmountPerGrid
				comm := math.Max(cost*config.CommissionRate, config.MinCommission)

				// If price is negative or zero? unlikely for stock.
				if cost > 0 {
					stat.BuyCount++
					stat.Commission += comm
					lastExecIndex = nextBuyIndex

					// Record Trade
					result.Trades = append(result.Trades, Trade{
						Time:   k.Timestamp,
						Type:   "BUY",
						Price:  nextBuyPrice,
						Amount: config.AmountPerGrid,
						Comm:   comm,
					})
				} else {
					break
				}
			} else {
				break
			}
		}

		// Check Sell Up
		for {
			nextSellIndex := lastExecIndex + 1
			var nextSellPrice float64
			var buyPrice float64

			if config.GridStepType == "absolute" {
				nextSellPrice = config.BasePrice + float64(nextSellIndex)*stepValue
				buyPrice = config.BasePrice + float64(nextSellIndex-1)*stepValue
			} else {
				nextSellPrice = config.BasePrice * (1 + float64(nextSellIndex)*stepValue)
				buyPrice = config.BasePrice * (1 + float64(nextSellIndex-1)*stepValue)
			}

			// Trigger Check
			triggered := false
			if config.UsePenetration {
				triggered = k.High > nextSellPrice // Price MUST break it
			} else {
				triggered = k.High >= nextSellPrice // Price only needs to touch it
			}

			if triggered {
				// Trigger Sell
				// Revenue
				revenue := nextSellPrice * config.AmountPerGrid
				comm := math.Max(revenue*config.CommissionRate, config.MinCommission)

				stat.SellCount++
				stat.Commission += comm

				// Profit Calculation
				// Matched against the hypothetical buy at (nextSellIndex - 1)
				// buyPrice calculated above
				gross := (nextSellPrice - buyPrice) * config.AmountPerGrid

				stat.GrossProfit += gross

				lastExecIndex = nextSellIndex

				// Record Trade
				result.Trades = append(result.Trades, Trade{
					Time:   k.Timestamp,
					Type:   "SELL",
					Price:  nextSellPrice,
					Amount: config.AmountPerGrid,
					Comm:   comm,
				})
			} else {
				break
			}
		}
	}

	// Aggregate
	var sortedStats []DailyStat
	for _, s := range dailyStatsMap {
		s.NetProfit = s.GrossProfit - s.Commission
		sortedStats = append(sortedStats, *s)

		result.TotalProfit += s.NetProfit
		result.TotalTx += (s.BuyCount + s.SellCount)
		result.TotalComm += s.Commission
	}

	// Sort
	sort.Slice(sortedStats, func(i, j int) bool {
		return sortedStats[i].Date < sortedStats[j].Date
	})
	result.DailyStats = sortedStats
	result.ChartData = klines // Return the data used for sim

	c.JSON(http.StatusOK, result)
}

func MathRound(x float64) float64 {
	return math.Round(x)
}
