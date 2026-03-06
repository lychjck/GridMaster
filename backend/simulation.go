package main

import (
	"log"
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
	SlippageRate   float64 `json:"slippageRate"`   // New: simulated slippage or bid/ask spread (e.g. 0.001 for 0.1%)
	AmountPerGrid  float64 `json:"amountPerGrid"`  // Default 100 shares
	InitialShares  int64   `json:"initialShares"`  // Base Position
	InitialCapital float64 `json:"initialCapital"` // Fixed base capital (0 = disabled/infinite)
	UsePenetration bool    `json:"usePenetration"` // New: Strict penetration mode
}

type DailyStat struct {
	Date           string  `json:"date"`
	BuyCount       int     `json:"buyCount"`
	SellCount      int     `json:"sellCount"`
	GrossProfit    float64 `json:"grossProfit"` // Realized profit
	Commission     float64 `json:"commission"`
	Value          float64 `json:"value"` // Market Value of Position (Initial + Net)
	RealizedProfit float64 `json:"realizedProfit"`
	NetProfit      float64 `json:"netProfit"` // Daily M2M PnL
	ClosePrice     float64 `json:"closePrice"`
	NetValue       float64 `json:"netValue"` // Daily Net Asset Value (Cash + Stock Market Value)
}

type Trade struct {
	Time   string  `json:"time"`
	Type   string  `json:"type"` // "BUY" | "SELL"
	Price  float64 `json:"price"`
	Amount float64 `json:"amount"`
	Comm   float64 `json:"comm"`
}

type SimResult struct {
	TotalProfit      float64       `json:"totalProfit"`
	TotalYieldAmount float64       `json:"totalYieldAmount"` // Total Strategy PnL
	TotalFloating    float64       `json:"totalFloating"`    // Floating PnL
	TotalTx          int           `json:"totalTx"`
	TotalComm        float64       `json:"totalComm"`
	NetPosition      float64       `json:"netPosition"`
	DailyStats       []DailyStat   `json:"dailyStats"`
	Trades           []Trade       `json:"trades"`
	ChartData        []Kline       `json:"chartData"`
	GridDensityData  []GridDensity `json:"gridDensityData"`
	MissedBuys       int           `json:"missedBuys"`  // Number of grid intervals skipped due to lack of cash
	MissedSells      int           `json:"missedSells"` // Number of grid intervals skipped due to lack of inventory

	// Advanced Metrics
	MaxDrawdown     float64 `json:"maxDrawdown"` // Percentage (e.g., -0.15 for -15%)
	SharpeRatio     float64 `json:"sharpeRatio"`
	CAGR            float64 `json:"cagr"`            // Compound Annual Growth Rate
	WinRate         float64 `json:"winRate"`         // Count of Profitable Grid Pairs / Total Completed Pairs
	BenchmarkReturn float64 `json:"benchmarkReturn"` // Stock Price Change %
	PeriodReturn    float64 `json:"periodReturn"`    // Un-annualized Strategy Return %
}

type GridDensity struct {
	PriceLevel float64 `json:"priceLevel"`
	TradeCount int     `json:"tradeCount"`
}

func RegisterSimulationRoutes(r *gin.Engine) {
	r.POST("/api/simulate", runSimulation)
	r.POST("/api/simulate/batch", runBatchSimulation)
}

func getSimulationData(symbol, startDate string) ([]Kline, float64, error) {
	var klines1m, klines5m []Kline
	if err := DB.Table("klines_1m").Where("symbol = ?", symbol).Where("timestamp >= ?", startDate).Order("timestamp asc").Find(&klines1m).Error; err != nil {
		return nil, 0, err
	}
	if err := DB.Table("klines_5m").Where("symbol = ?", symbol).Where("timestamp >= ?", startDate).Order("timestamp asc").Find(&klines5m).Error; err != nil {
		return nil, 0, err
	}

	datesWith1m := make(map[string]bool)
	for _, k := range klines1m {
		if len(k.Timestamp) >= 10 {
			datesWith1m[k.Timestamp[:10]] = true
		}
	}

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

	sort.Slice(klines, func(i, j int) bool {
		return klines[i].Timestamp < klines[j].Timestamp
	})

	if len(klines) == 0 {
		return nil, 0, nil
	}

	firstPrice := klines[0].Open
	preClosePrice := firstPrice
	var preCloseKline Kline
	if err := DB.Table("klines_daily").Where("symbol = ? AND timestamp < ?", symbol, startDate).Order("timestamp desc").First(&preCloseKline).Error; err == nil {
		preClosePrice = preCloseKline.Close
	}

	return klines, preClosePrice, nil
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
	}

	klines, preClosePrice, err := getSimulationData(config.Symbol, config.StartDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if len(klines) == 0 {
		c.JSON(http.StatusOK, SimResult{})
		return
	}

	result := calcSimulation(klines, config, preClosePrice)
	c.JSON(http.StatusOK, result)
}

type BatchSimConfig struct {
	Symbol         string  `json:"symbol"`
	StartDate      string  `json:"startDate"`
	BasePrice      float64 `json:"basePrice"`
	MinStep        float64 `json:"minStep"`
	MaxStep        float64 `json:"maxStep"`
	StepInterval   float64 `json:"stepInterval"`
	GridStepType   string  `json:"gridStepType"`
	CommissionRate float64 `json:"commissionRate"`
	MinCommission  float64 `json:"minCommission"`
	SlippageRate   float64 `json:"slippageRate"`
	AmountPerGrid  float64 `json:"amountPerGrid"`
	InitialShares  int64   `json:"initialShares"`
	InitialCapital float64 `json:"initialCapital"`
	UsePenetration bool    `json:"usePenetration"`
}

type BatchSimResult struct {
	Step        float64 `json:"step"`
	MaxDrawdown float64 `json:"maxDrawdown"`
	GridProfit  float64 `json:"gridProfit"`
	FloatProfit float64 `json:"floatProfit"`
	TotalProfit float64 `json:"totalProfit"`
	NetPosition float64 `json:"netPosition"`
	MissedBuys  int     `json:"missedBuys"`
	MissedSells int     `json:"missedSells"`
	TotalTx     int     `json:"totalTx"`
	SharpeRatio float64 `json:"sharpeRatio"`
	WinRate     float64 `json:"winRate"`
}

func runBatchSimulation(c *gin.Context) {
	var config BatchSimConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		log.Printf("Batch Simulation Binding Error: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if config.Symbol == "" {
		config.Symbol = "512890"
	}
	if config.AmountPerGrid <= 0 {
		config.AmountPerGrid = 100
	}
	if config.MinStep <= 0 || config.MaxStep <= 0 || config.StepInterval <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid step parameters"})
		return
	}

	klines, preClosePrice, err := getSimulationData(config.Symbol, config.StartDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if len(klines) == 0 {
		c.JSON(http.StatusOK, []BatchSimResult{})
		return
	}

	var results []BatchSimResult

	for step := config.MinStep; step <= config.MaxStep; step += config.StepInterval {
		step = RoundTo3(step) // avoid float precision drift
		simConf := SimConfig{
			Symbol:         config.Symbol,
			StartDate:      config.StartDate,
			BasePrice:      config.BasePrice,
			GridStep:       step,
			GridStepType:   config.GridStepType,
			CommissionRate: config.CommissionRate,
			MinCommission:  config.MinCommission,
			SlippageRate:   config.SlippageRate,
			AmountPerGrid:  config.AmountPerGrid,
			InitialShares:  config.InitialShares,
			InitialCapital: config.InitialCapital,
			UsePenetration: config.UsePenetration,
		}

		res := calcSimulation(klines, simConf, preClosePrice)

		results = append(results, BatchSimResult{
			Step:        step,
			MaxDrawdown: res.MaxDrawdown,
			GridProfit:  res.TotalProfit,
			FloatProfit: res.TotalFloating,
			TotalProfit: res.TotalYieldAmount,
			NetPosition: float64(res.NetPosition), // cast to float64 for generic JSON marshaling if needed, though int is fine. keeping it consistent.
			MissedBuys:  res.MissedBuys,
			MissedSells: res.MissedSells,
			TotalTx:     res.TotalTx,
			SharpeRatio: res.SharpeRatio,
			WinRate:     res.WinRate,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": results})
}

func calcSimulation(klines []Kline, config SimConfig, preClosePrice float64) SimResult {
	if len(klines) == 0 {
		return SimResult{}
	}

	firstPrice := klines[0].Open

	var initialIndex int
	var stepValue float64

	if config.GridStepType == "absolute" {
		stepValue = config.GridStep
		initialIndex = int((firstPrice - config.BasePrice) / stepValue)
	} else {
		stepValue = config.GridStep / 100.0
		initialIndex = int((firstPrice/config.BasePrice - 1) / stepValue)
	}

	lastExecIndex := initialIndex
	currentCash := config.InitialCapital // 0 means infinity
	currentPos := 0.0
	dailyStatsMap := make(map[string]*DailyStat)
	gridDensityMap := make(map[float64]int)
	var result SimResult

	initialPosValueAtStart := float64(config.InitialShares) * preClosePrice
	minCash := -initialPosValueAtStart

	if config.InitialCapital > 0 {
		minCash = currentCash - initialPosValueAtStart // Use provided capital instead
	}

	for _, k := range klines {
		date := k.Timestamp[:10]
		if _, ok := dailyStatsMap[date]; !ok {
			dailyStatsMap[date] = &DailyStat{
				Date:  date,
				Value: float64(config.InitialShares) * k.Close,
			}
		}
		stat := dailyStatsMap[date]
		stat.ClosePrice = RoundTo3(k.Close)

		passes := []string{"B", "S"}
		if k.Open > k.Close {
			passes = []string{"S", "B"}
		}

		for _, pType := range passes {
			if pType == "B" {
				for {
					nextBuyIndex := lastExecIndex - 1
					var nextBuyPrice float64

					if config.GridStepType == "absolute" {
						nextBuyPrice = RoundTo3(config.BasePrice + float64(nextBuyIndex)*stepValue)
					} else {
						nextBuyPrice = RoundTo3(config.BasePrice * (1 + float64(nextBuyIndex)*stepValue))
					}

					triggered := false
					if config.UsePenetration {
						triggered = RoundTo3(k.Low) < nextBuyPrice-0.00001
					} else {
						triggered = RoundTo3(k.Low) <= nextBuyPrice+0.00001
					}

					if triggered {
						// Apply Slippage: buy higher
						actualBuyPrice := nextBuyPrice * (1 + config.SlippageRate)
						cost := actualBuyPrice * config.AmountPerGrid
						comm := math.Max(cost*config.CommissionRate, config.MinCommission)

						// Check if we hit capital limit
						if config.InitialCapital > 0 && currentCash < (cost+comm) {
							result.MissedBuys++
							break
						}

						if cost > 0 {
							stat.BuyCount++
							stat.Commission += comm
							lastExecIndex = nextBuyIndex

							currentCash -= (cost + comm)
							currentPos += config.AmountPerGrid
							if currentCash < minCash {
								minCash = currentCash
							}

							result.Trades = append(result.Trades, Trade{
								Time:   k.Timestamp,
								Type:   "BUY",
								Price:  RoundTo3(actualBuyPrice),
								Amount: config.AmountPerGrid,
								Comm:   RoundTo3(comm),
							})

							priceKey := RoundTo3(nextBuyPrice)
							gridDensityMap[priceKey]++
						} else {
							break
						}
					} else {
						break
					}
				}
			} else {
				for {
					nextSellIndex := lastExecIndex + 1
					var nextSellPrice float64
					var buyPrice float64

					if config.GridStepType == "absolute" {
						nextSellPrice = RoundTo3(config.BasePrice + float64(nextSellIndex)*stepValue)
						buyPrice = RoundTo3(config.BasePrice + float64(nextSellIndex-1)*stepValue)
					} else {
						nextSellPrice = RoundTo3(config.BasePrice * (1 + float64(nextSellIndex)*stepValue))
						buyPrice = RoundTo3(config.BasePrice * (1 + float64(nextSellIndex-1)*stepValue))
					}

					triggered := false
					if config.UsePenetration {
						triggered = RoundTo3(k.High) > nextSellPrice+0.00001
					} else {
						triggered = RoundTo3(k.High) >= nextSellPrice-0.00001
					}

					if triggered {
						// Check if we have inventory to sell
						if float64(config.InitialShares)+currentPos < config.AmountPerGrid-0.0001 {
							// No inventory, just move the grid up
							result.MissedSells++
							lastExecIndex = nextSellIndex
							continue
						}

						// Apply Slippage: sell lower
						actualSellPrice := nextSellPrice * (1 - config.SlippageRate)
						revenue := actualSellPrice * config.AmountPerGrid
						comm := math.Max(revenue*config.CommissionRate, config.MinCommission)

						stat.SellCount++
						stat.Commission += comm

						// True cost basis needs to track average cost ideally, but we rely on simple match.
						// Using target buy price for PnL calculation is slightly inaccurate if buying slippage isn't matched.
						// To be fair, let's calculate gross using actualSellPrice - (buyPrice * (1+Slippage))
						actualBuyPriceForThisSell := buyPrice * (1 + config.SlippageRate)
						gross := (actualSellPrice - actualBuyPriceForThisSell) * config.AmountPerGrid
						stat.GrossProfit += gross

						lastExecIndex = nextSellIndex

						currentCash += (revenue - comm)
						currentPos -= config.AmountPerGrid

						result.Trades = append(result.Trades, Trade{
							Time:   k.Timestamp,
							Type:   "SELL",
							Price:  RoundTo3(actualSellPrice),
							Amount: config.AmountPerGrid,
							Comm:   RoundTo3(comm),
						})

						priceKey := RoundTo3(nextSellPrice)
						gridDensityMap[priceKey]++
					} else {
						break
					}
				}
			}
		}

		marketValue := currentPos * k.Close
		stat.NetValue = currentCash + marketValue
	}

	var sortedStats []DailyStat
	var totalBuyCount, totalSellCount int
	var dailyNetValues []float64

	initialCapital := config.InitialCapital
	if initialCapital == 0 {
		initialCapital = math.Abs(minCash)
		if initialCapital == 0 {
			initialCapital = firstPrice * config.AmountPerGrid
		}
	}

	for _, s := range dailyStatsMap {
		s.RealizedProfit = RoundTo3(s.GrossProfit - s.Commission)
		s.GrossProfit = RoundTo3(s.GrossProfit)
		s.Commission = RoundTo3(s.Commission)
		sortedStats = append(sortedStats, *s)

		result.TotalProfit += s.RealizedProfit
		result.TotalTx += (s.BuyCount + s.SellCount)
		result.TotalComm += s.Commission
		totalBuyCount += s.BuyCount
		totalSellCount += s.SellCount
	}

	sort.Slice(sortedStats, func(i, j int) bool {
		return sortedStats[i].Date < sortedStats[j].Date
	})

	maxEquity := initialCapital
	minEquity := initialCapital
	maxDrawdown := 0.0
	var lastEquity float64 = initialCapital

	for i := range sortedStats {
		s := &sortedStats[i]

		InitialPosPnL := float64(config.InitialShares) * (s.ClosePrice - preClosePrice)
		equity := initialCapital + s.NetValue + InitialPosPnL

		s.NetProfit = RoundTo3(equity - lastEquity)
		lastEquity = equity

		if equity > maxEquity {
			maxEquity = equity
		}
		if equity < minEquity {
			minEquity = equity
		}

		if maxEquity > 0 {
			drawdown := (equity - maxEquity) / maxEquity
			if drawdown < maxDrawdown {
				maxDrawdown = drawdown
			}
		}
		dailyNetValues = append(dailyNetValues, equity)
	}

	result.NetPosition = float64(int64(totalBuyCount-totalSellCount)*int64(config.AmountPerGrid) + config.InitialShares)
	result.TotalProfit = RoundTo3(result.TotalProfit)
	result.TotalComm = RoundTo3(result.TotalComm)
	result.DailyStats = sortedStats
	result.ChartData = klines

	var gridDensityData []GridDensity
	for price, count := range gridDensityMap {
		gridDensityData = append(gridDensityData, GridDensity{
			PriceLevel: price,
			TradeCount: count,
		})
	}
	sort.Slice(gridDensityData, func(i, j int) bool {
		return gridDensityData[i].PriceLevel < gridDensityData[j].PriceLevel
	})
	result.GridDensityData = gridDensityData

	result.MaxDrawdown = RoundTo3(math.Abs(maxDrawdown) * 100)

	if totalBuyCount > 0 {
		result.WinRate = RoundTo3(float64(totalSellCount) / float64(totalBuyCount) * 100)
	} else {
		result.WinRate = 0
	}

	var dailyReturns []float64
	for i := 1; i < len(dailyNetValues); i++ {
		r := (dailyNetValues[i] - dailyNetValues[i-1]) / dailyNetValues[i-1]
		dailyReturns = append(dailyReturns, r)
	}
	if len(dailyReturns) > 0 {
		meanReturn := Mean(dailyReturns)
		stdDev := StdDev(dailyReturns, meanReturn)
		if stdDev > 0 {
			result.SharpeRatio = RoundTo3((meanReturn / stdDev) * math.Sqrt(252))
		}
	} else {
		result.SharpeRatio = 0
	}

	if len(sortedStats) > 1 {
		startStr := sortedStats[0].Date
		endStr := sortedStats[len(sortedStats)-1].Date
		t1, _ := time.Parse("2006-01-02", startStr)
		t2, _ := time.Parse("2006-01-02", endStr)
		days := t2.Sub(t1).Hours() / 24

		if days > 0 {
			finalEquity := dailyNetValues[len(dailyNetValues)-1]
			growth := finalEquity / initialCapital
			years := days / 365.0
			if years > 0 {
				result.CAGR = RoundTo3((math.Pow(growth, 1.0/years) - 1) * 100)
			}
		}
	}

	if initialCapital > 0 && len(dailyNetValues) > 0 {
		finalEquity := dailyNetValues[len(dailyNetValues)-1]
		result.PeriodReturn = RoundTo3((finalEquity/initialCapital - 1) * 100)
		result.TotalYieldAmount = RoundTo3(finalEquity - initialCapital)
		result.TotalFloating = RoundTo3(result.TotalYieldAmount - result.TotalProfit)
	}

	if preClosePrice > 0 {
		lastPrice := klines[len(klines)-1].Close
		result.BenchmarkReturn = RoundTo3((lastPrice - preClosePrice) / preClosePrice * 100)
	}

	result.NetPosition = float64(config.InitialShares) + currentPos

	return result
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
