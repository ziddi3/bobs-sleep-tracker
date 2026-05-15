/* ============================================================
   AGENT 1: ANALYST AGENT
   Reads sleep data, computes patterns, generates insights
   ============================================================ */

class AnalystAgent {
  constructor(orchestrator) {
    this.name = "Analyst";
    this.id = "analyst";
    this.orchestrator = orchestrator;
    this.lastAnalysis = null;
  }

  /* ── Core Analysis ─────────────────────────────────────── */
  analyze(entries) {
    if (!entries || entries.length === 0) {
      return this._emptyReport();
    }

    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const known  = sorted.filter(e => e.status !== "unknown");
    const unknown = sorted.filter(e => e.status === "unknown");
    const noSleep = known.filter(e => Number(e.hours) === 0);
    const sleepDays = known.filter(e => Number(e.hours) > 0);
    const fullSleep  = known.filter(e => Number(e.hours) >= 8);

    const totalKnownHours = known.reduce((s, e) => s + Number(e.hours || 0), 0);
    const avgPerKnownDay  = known.length ? totalKnownHours / known.length : 0;
    const avgPerSleepNight = sleepDays.length ? totalKnownHours / sleepDays.length : 0;
    const unknownRate     = entries.length ? unknown.length / entries.length : 0;
    const fullSleepRate   = known.length ? fullSleep.length / known.length : 0;
    const noSleepRate     = known.length ? noSleep.length / known.length : 0;

    // Streak analysis
    const streaks = this._calcStreaks(sorted);
    // Trend (last 7 vs prior 7)
    const trend   = this._calcTrend(known);
    // Pattern tags
    const patterns = this._identifyPatterns(known, noSleepRate, avgPerKnownDay, fullSleepRate);
    // Insights
    const insights = this._generateInsights({
      avgPerKnownDay, avgPerSleepNight, noSleepRate, fullSleepRate,
      unknownRate, streaks, trend, totalKnownHours,
      D: entries.length, knownCount: known.length,
      noSleepCount: noSleep.length, sleepCount: sleepDays.length,
      fullCount: fullSleep.length, unknownCount: unknown.length
    });

    this.lastAnalysis = {
      stats: {
        D: entries.length,
        knownCount: known.length,
        unknownCount: unknown.length,
        noSleepCount: noSleep.length,
        sleepCount: sleepDays.length,
        fullCount: fullSleep.length,
        totalKnownHours: Math.round(totalKnownHours * 100) / 100,
        avgPerKnownDay:  Math.round(avgPerKnownDay  * 100) / 100,
        avgPerSleepNight: Math.round(avgPerSleepNight * 100) / 100,
        unknownRate:   Math.round(unknownRate  * 1000) / 10,
        fullSleepRate: Math.round(fullSleepRate * 1000) / 10,
        noSleepRate:   Math.round(noSleepRate  * 1000) / 10,
      },
      streaks,
      trend,
      patterns,
      insights,
      computedAt: new Date().toISOString()
    };

    this.orchestrator.emit("analyst:complete", this.lastAnalysis);
    return this.lastAnalysis;
  }

  /* ── Streak Calculation ────────────────────────────────── */
  _calcStreaks(sorted) {
    let currentSleepStreak = 0, bestSleepStreak = 0;
    let currentNoSleepStreak = 0, bestNoSleepStreak = 0;

    for (const e of sorted) {
      if (e.status === "unknown") { currentSleepStreak = 0; currentNoSleepStreak = 0; continue; }
      if (Number(e.hours) > 0) {
        currentSleepStreak++;
        currentNoSleepStreak = 0;
        if (currentSleepStreak > bestSleepStreak) bestSleepStreak = currentSleepStreak;
      } else {
        currentNoSleepStreak++;
        currentSleepStreak = 0;
        if (currentNoSleepStreak > bestNoSleepStreak) bestNoSleepStreak = currentNoSleepStreak;
      }
    }

    return { currentSleepStreak, bestSleepStreak, currentNoSleepStreak, bestNoSleepStreak };
  }

  /* ── Trend (last 7 vs prior 7) ─────────────────────────── */
  _calcTrend(known) {
    if (known.length < 7) return { direction: "insufficient_data", delta: 0 };
    const last7  = known.slice(-7);
    const prior7 = known.slice(-14, -7);
    if (prior7.length === 0) return { direction: "insufficient_data", delta: 0 };

    const avg7  = last7.reduce((s,e) => s + Number(e.hours||0), 0) / last7.length;
    const avgP7 = prior7.reduce((s,e) => s + Number(e.hours||0), 0) / prior7.length;
    const delta = avg7 - avgP7;

    return {
      direction: delta > 0.3 ? "improving" : delta < -0.3 ? "declining" : "stable",
      delta: Math.round(delta * 100) / 100,
      last7Avg:  Math.round(avg7  * 100) / 100,
      prior7Avg: Math.round(avgP7 * 100) / 100
    };
  }

  /* ── Pattern Detection ─────────────────────────────────── */
  _identifyPatterns(known, noSleepRate, avg, fullRate) {
    const tags = [];
    if (avg >= 7)           tags.push({ id: "good_avg",       label: "Healthy Average",     color: "good" });
    if (avg >= 8)           tags.push({ id: "optimal_avg",    label: "Optimal Sleep",        color: "good" });
    if (avg < 6 && avg > 0) tags.push({ id: "sleep_deprived", label: "Sleep Deprived",       color: "bad"  });
    if (avg < 4 && avg > 0) tags.push({ id: "severe_deficit", label: "Severe Deficit",       color: "bad"  });
    if (noSleepRate > 0.3)  tags.push({ id: "frequent_miss",  label: "Frequent No-Sleep",    color: "bad"  });
    if (noSleepRate > 0.5)  tags.push({ id: "chronic_insomnia","label": "Chronic Pattern",   color: "bad"  });
    if (fullRate > 0.5)     tags.push({ id: "consistent_full","label": "Consistently Full",  color: "good" });
    if (known.length < 7)   tags.push({ id: "low_data",       label: "Low Data Sample",      color: "warn" });
    return tags;
  }

  /* ── Insight Generation ────────────────────────────────── */
  _generateInsights(d) {
    const insights = [];

    // Average assessment
    if (d.avgPerKnownDay >= 8) {
      insights.push({ icon: "✅", text: `Averaging ${d.avgPerKnownDay}h/night — meeting the 8h recommended threshold consistently.` });
    } else if (d.avgPerKnownDay >= 6) {
      insights.push({ icon: "⚠️", text: `Averaging ${d.avgPerKnownDay}h/night — slightly below the 8h recommendation. Small improvements compound.` });
    } else if (d.avgPerKnownDay > 0) {
      insights.push({ icon: "🔴", text: `Averaging only ${d.avgPerKnownDay}h/night — significantly below the healthy threshold. Cognitive and health impact is likely accumulating.` });
    }

    // No-sleep frequency
    if (d.noSleepRate > 0.3) {
      insights.push({ icon: "🔴", text: `${Math.round(d.noSleepRate * 100)}% of known days show zero sleep — this is a clinically significant frequency worth discussing with a professional.` });
    } else if (d.noSleepCount > 0) {
      insights.push({ icon: "⚠️", text: `${d.noSleepCount} confirmed no-sleep day(s) recorded out of ${d.knownCount} known days.` });
    }

    // Unknown data quality
    if (d.unknownRate > 0.2) {
      insights.push({ icon: "📊", text: `${Math.round(d.unknownRate * 10)}% unknown days reduce sample integrity. Filling these in improves pattern accuracy.` });
    }

    // Trend
    if (d.trend.direction === "improving") {
      insights.push({ icon: "📈", text: `7-day trend is improving: recent avg ${d.trend.last7Avg}h vs prior ${d.trend.prior7Avg}h — a positive trajectory.` });
    } else if (d.trend.direction === "declining") {
      insights.push({ icon: "📉", text: `7-day trend is declining: recent avg ${d.trend.last7Avg}h vs prior ${d.trend.prior7Avg}h — worth monitoring closely.` });
    }

    // Full sleep frequency
    if (d.fullSleepRate > 0.5) {
      insights.push({ icon: "🌟", text: `${Math.round(d.fullSleepRate * 100)}% of known days include 8+ hours — strong recovery pattern.` });
    }

    // Data size
    if (d.D < 7) {
      insights.push({ icon: "ℹ️", text: `Only ${d.D} day(s) recorded. Pattern analysis strengthens significantly with 14–30 days of data.` });
    }

    return insights;
  }

  /* ── Empty Report ──────────────────────────────────────── */
  _emptyReport() {
    return {
      stats: { D: 0, knownCount: 0, unknownCount: 0, noSleepCount: 0, sleepCount: 0, fullCount: 0, totalKnownHours: 0, avgPerKnownDay: 0, avgPerSleepNight: 0, unknownRate: 0, fullSleepRate: 0, noSleepRate: 0 },
      streaks: { currentSleepStreak: 0, bestSleepStreak: 0, currentNoSleepStreak: 0, bestNoSleepStreak: 0 },
      trend: { direction: "no_data", delta: 0 },
      patterns: [],
      insights: [{ icon: "ℹ️", text: "No data recorded yet. Start logging sleep days to generate analysis." }],
      computedAt: new Date().toISOString()
    };
  }

  /* ── Context Summary (for other agents) ───────────────── */
  getContextSummary() {
    if (!this.lastAnalysis) return "No analysis available yet.";
    const s = this.lastAnalysis.stats;
    const t = this.lastAnalysis.trend;
    return `Sleep data summary: ${s.D} total days, ${s.knownCount} known. Average ${s.avgPerKnownDay}h/day. ${s.noSleepCount} zero-sleep days (${s.noSleepRate}%). ${s.fullCount} full-sleep days (8h+). Trend: ${t.direction}. Unknown data gap: ${s.unknownRate}%.`;
  }
}

window.AnalystAgent = AnalystAgent;