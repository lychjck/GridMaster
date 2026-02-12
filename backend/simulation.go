package main

import (
	"math"
	"net/http"
	"sort"
	"time"

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
	NetValue    float64 `json:"netValue"` // Daily Net Asset Value (Cash + Stock Market Value)
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

	// Advanced Metrics
	MaxDrawdown     float64 `json:"maxDrawdown"` // Percentage (e.g., -0.15 for -15%)
	SharpeRatio     float64 `json:"sharpeRatio"`
	CAGR            float64 `json:"cagr"`            // Compound Annual Growth Rate
	WinRate         float64 `json:"winRate"`         // Count of Profitable Grid Pairs / Total Completed Pairs
	BenchmarkReturn float64 `json:"benchmarkReturn"` // Stock Price Change %
	PeriodReturn    float64 `json:"periodReturn"`    // Un-annualized Strategy Return %
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
	firstPrice := klines[0].Open

	// Initial Index Calculation
	var initialIndex int
	var stepValue float64 // either price diff or ratio

	if config.GridStepType == "absolute" {
		stepValue = config.GridStep
		initialIndex = int((firstPrice - config.BasePrice) / stepValue)
	} else {
		stepValue = config.GridStep / 100.0
		initialIndex = int((firstPrice/config.BasePrice - 1) / stepValue)
	}

	lastExecIndex := initialIndex

	// Fetch Pre-Close Price for Benchmark Calculation
	preClosePrice := firstPrice // Fallback to open price
	var preCloseKline Kline
	if err := DB.Table("klines_daily").Where("symbol = ? AND timestamp < ?", config.Symbol, config.StartDate).Order("timestamp desc").First(&preCloseKline).Error; err == nil {
		preClosePrice = preCloseKline.Close
	}

	// Portfolio Tracking for Advanced Metrics
	// Assume initial cash large enough to cover all buys, to calculate NAV change correctly.
	// Or simplistic NAV = Cash Balance Change + Stock Market Value
	// Initial State: 0 Cash Change, 0 Position.
	// We only track relative profit, not absolute total portfolio value (since we don't have total capital).
	// BUT for Drawdown and CAGR, we usually need a Total Capital base.
	// Estimation: Max Capital Used + Buffer? Or just assume a fixed initial capital?
	// Let's dynamically estimate "required capital" or just use a fixed large number like 1,000,000 for relative metrics.
	// Better: Track Cumulative PnL + Position Value.
	// Max Drawdown of (Cumulative PnL + Unrealized PnL).

	currentCash := 0.0
	currentPos := 0.0

	// Stats
	dailyStatsMap := make(map[string]*DailyStat)
	var result SimResult

	// Track minCash to determine "Required Capital" (Max Investment)
	minCash := 0.0

	// Loop
	for _, k := range klines {
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

			triggered := false
			if config.UsePenetration {
				triggered = k.Low < nextBuyPrice
			} else {
				triggered = k.Low <= nextBuyPrice
			}

			if triggered {
				cost := nextBuyPrice * config.AmountPerGrid
				comm := math.Max(cost*config.CommissionRate, config.MinCommission)

				if cost > 0 {
					stat.BuyCount++
					stat.Commission += comm
					lastExecIndex = nextBuyIndex

					// Update Portfolio
					currentCash -= (cost + comm)
					currentPos += config.AmountPerGrid
					if currentCash < minCash {
						minCash = currentCash
					}

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

			triggered := false
			if config.UsePenetration {
				triggered = k.High > nextSellPrice
			} else {
				triggered = k.High >= nextSellPrice
			}

			if triggered {
				revenue := nextSellPrice * config.AmountPerGrid
				comm := math.Max(revenue*config.CommissionRate, config.MinCommission)

				stat.SellCount++
				stat.Commission += comm

				// Realized Profit for this pair
				gross := (nextSellPrice - buyPrice) * config.AmountPerGrid
				stat.GrossProfit += gross

				lastExecIndex = nextSellIndex

				// Update Portfolio
				currentCash += (revenue - comm)
				currentPos -= config.AmountPerGrid
				// Selling increases cash, so minCash usually won't change here unless negative revenue (impossible)

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

		// Update Daily Net Value (Snapshot at day close)
		// Simulating "Total Account Value = Initial Capital + Cash Change + Stock Value"
		marketValue := currentPos * k.Close
		stat.NetValue = currentCash + marketValue
	}

	// 4. CAGR
	// (End / Start) ^ (365 / Days) - 1
	var sortedStats []DailyStat
	var totalBuyCount, totalSellCount int
	var dailyNetValues []float64

	// Determine Initial Capital (Max Invested)
	// minCash is negative of Max Investment.
	initialCapital := math.Abs(minCash)
	if initialCapital == 0 {
		initialCapital = firstPrice * config.AmountPerGrid // Fallback to 1 unit cost if no trades
	}

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

	// Sort Stats by Date
	sort.Slice(sortedStats, func(i, j int) bool {
		return sortedStats[i].Date < sortedStats[j].Date
	})

	// Re-iterate sorted stats to build Daily Equity Curve for Metrics
	// Re-calculate daily cumulative net value correctly
	maxEquity := initialCapital
	minEquity := initialCapital
	maxDrawdown := 0.0

	for _, s := range sortedStats {
		// Convert "NetValue PnL" to "Total Equity"
		// NetValue from sim is (CashChange + StockValue).
		// Equity = Initial + NetValue.
		equity := initialCapital + s.NetValue

		// Max Drawdown Calculation
		if equity > maxEquity {
			maxEquity = equity
		}
		if equity < minEquity {
			minEquity = equity
		}

		// Drawdown
		if maxEquity > 0 {
			drawdown := (equity - maxEquity) / maxEquity
			// drawdown is negative (e.g. -0.1).
			// We want to track the "deepest" drawdown (most negative).
			if drawdown < maxDrawdown {
				maxDrawdown = drawdown
			}
		}
		dailyNetValues = append(dailyNetValues, equity)
	}

	result.NetPosition = float64(totalBuyCount-totalSellCount) * config.AmountPerGrid
	result.TotalProfit = RoundTo3(result.TotalProfit)
	result.TotalComm = RoundTo3(result.TotalComm)
	result.DailyStats = sortedStats
	result.ChartData = klines

	// 1. Max Drawdown
	// Return as positive percentage (Magnitude of drop)
	// User expects "Max Drawdown: 15%" to mean the curve dropped 15%.
	result.MaxDrawdown = RoundTo3(math.Abs(maxDrawdown) * 100)

	// 2. Win Rate (Arbitrage Pairs)
	// Simplified: Every Sell is a "Win" (profit). Every Net Position is "Pending".
	// Win Rate = Sell Count / (Sell Count + Remaining Position)?
	// Actually, strict Win Rate in grid is 100% for closed pairs (unless stop loss).
	// But let's define it as "Profitable Trades / Total Trades"?
	// In our logic, `Sell` triggers profit. `Buy` opens.
	// Let's use Sell Count / Total Tx for now? No, that's just activity ratio.
	// Let's use: (Sell Pairs) / (Sell Pairs + Unclosed Buys) ??
	// Let's use: Total Sell Count / (Total Buy Count). Use with caution.
	// If Buy=10, Sell=5. Win=5, Pending=5.
	// Let's just return ratio of Sells to Buys as "Completion Rate"?
	// Standard "Win Rate" for Grid is often "closed pairs / (closed pairs + stop losses)".
	// Since we have no stop loss, is it 100%?
	// Let's calculate "Floating Loss" vs "Realized Profit".
	// Let's stick to simple "Sell Count / Buy Count" ratio for now as "Grid Completion Rate".
	if totalBuyCount > 0 {
		result.WinRate = RoundTo3(float64(totalSellCount) / float64(totalBuyCount) * 100)
	} else {
		result.WinRate = 0
	}

	// 3. Sharpe Ratio
	// Daily Returns = (Equity_t - Equity_t-1) / Equity_t-1
	var dailyReturns []float64
	for i := 1; i < len(dailyNetValues); i++ {
		r := (dailyNetValues[i] - dailyNetValues[i-1]) / dailyNetValues[i-1]
		dailyReturns = append(dailyReturns, r)
	}
	if len(dailyReturns) > 0 {
		meanReturn := Mean(dailyReturns)
		stdDev := StdDev(dailyReturns, meanReturn)
		// Annualized Sharpe = (MeanDaily - RiskFree) / StdDaily * Sqrt(252)
		// Assume RiskFree = 0
		if stdDev > 0 {
			result.SharpeRatio = RoundTo3((meanReturn / stdDev) * math.Sqrt(252))
		}
	} else {
		result.SharpeRatio = 0
	}

	// 4. CAGR
	// (End / Start) ^ (365 / Days) - 1
	if len(sortedStats) > 1 {
		startStr := sortedStats[0].Date
		endStr := sortedStats[len(sortedStats)-1].Date
		t1, _ := time.Parse("2006-01-02", startStr)
		t2, _ := time.Parse("2006-01-02", endStr)
		days := t2.Sub(t1).Hours() / 24

		if days > 0 {
			finalEquity := dailyNetValues[len(dailyNetValues)-1]
			// CAGR needs meaningful initial capital.
			// If we started with 1M, and profit is small, CAGR is small.
			// This depends on "Capital Utilization".
			// A true Grid CAGR is hard.
			// Let's approximate: CAGR of the "Employed Capital" is hard to track.
			// Let's use the fixed 1M capital base for consistency with Drawdown.
			// Note: This might underestimate return if capital usage was low.
			// But consistent with safe capital mgmt.
			growth := finalEquity / initialCapital
			years := days / 365.0
			if years > 0 {
				result.CAGR = RoundTo3((math.Pow(growth, 1.0/years) - 1) * 100)
			}
		}
	}

	// 5. Period Return (Un-annualized Strategy Yield)
	if initialCapital > 0 {
		finalEquity := dailyNetValues[len(dailyNetValues)-1]
		result.PeriodReturn = RoundTo3((finalEquity/initialCapital - 1) * 100)
	}

	// 6. Benchmark Return (Stock Price Change relative to Pre-Close)
	if preClosePrice > 0 {
		lastPrice := klines[len(klines)-1].Close
		result.BenchmarkReturn = RoundTo3((lastPrice - preClosePrice) / preClosePrice * 100)
	}

	c.JSON(http.StatusOK, result)
}

func Mean(data []float64) float64 {
	sum := 0.0
	for _, v := range data {
		sum += v
	}
	return sum / float64(len(data))
}

func StdDev(data []float64, mean float64) float64 {
	sum := 0.0
	for _, v := range data {
		sum += math.Pow(v-mean, 2)
	}
	return math.Sqrt(sum / float64(len(data)))
}

func MathRound(x float64) float64 {
	return math.Round(x)
}

func RoundTo3(x float64) float64 {
	return math.Round(x*1000) / 1000
}
