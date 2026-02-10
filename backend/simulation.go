package main

import (
	"math"
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
)

type SimConfig struct {
	Symbol         string  `json:"symbol"` // New: Stock Symbol
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
	NetPosition float64     `json:"netPosition"`
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
	if config.Symbol == "" {
		config.Symbol = "512890"
	}
	if config.GridStep <= 0 {
		config.GridStep = 1.0
	}
	if config.AmountPerGrid <= 0 {
		config.AmountPerGrid = 100
	} // Default 100 shares

	// 1. Fetch Data (Hybrid 1m/5m approach to ensure coverage)
	var klines1m, klines5m []Kline
	if err := DB.Table("klines_1m").Where("symbol = ?", config.Symbol).Where("timestamp >= ?", config.StartDate).Order("timestamp asc").Find(&klines1m).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := DB.Table("klines_5m").Where("symbol = ?", config.Symbol).Where("timestamp >= ?", config.StartDate).Order("timestamp asc").Find(&klines5m).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Identification of dates that have 1m data
	datesWith1m := make(map[string]bool)
	for _, k := range klines1m {
		if len(k.Timestamp) >= 10 {
			datesWith1m[k.Timestamp[:10]] = true
		}
	}

	// Merge: Use 1m if available, otherwise 5m
	var klines []Kline
	klines = append(klines, klines1m...)
	for _, k := range klines5m {
		if len(k.Timestamp) >= 10 {
			date := k.Timestamp[:10]
			if _, has1m := datesWith1m[date]; !has1m {
				klines = append(klines, k)
			}
		}
	}

	// Sort by timestamp
	sort.Slice(klines, func(i, j int) bool {
		return klines[i].Timestamp < klines[j].Timestamp
	})

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
		stat.ClosePrice = RoundTo3(k.Close) // Update close

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
						Price:  RoundTo3(nextBuyPrice),
						Amount: config.AmountPerGrid,
						Comm:   RoundTo3(comm),
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
					Price:  RoundTo3(nextSellPrice),
					Amount: config.AmountPerGrid,
					Comm:   RoundTo3(comm),
				})
			} else {
				break
			}
		}
	}

	// Aggregate
	var sortedStats []DailyStat
	var totalBuyCount, totalSellCount int
	for _, s := range dailyStatsMap {
		s.NetProfit = RoundTo3(s.GrossProfit - s.Commission)
		s.GrossProfit = RoundTo3(s.GrossProfit)
		s.Commission = RoundTo3(s.Commission)
		sortedStats = append(sortedStats, *s)

		result.TotalProfit += s.NetProfit
		result.TotalTx += (s.BuyCount + s.SellCount)
		result.TotalComm += s.Commission
		totalBuyCount += s.BuyCount
		totalSellCount += s.SellCount
	}
	result.NetPosition = float64(totalBuyCount-totalSellCount) * config.AmountPerGrid
	result.TotalProfit = RoundTo3(result.TotalProfit)
	result.TotalComm = RoundTo3(result.TotalComm)

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

func RoundTo3(x float64) float64 {
	return math.Round(x*1000) / 1000
}
