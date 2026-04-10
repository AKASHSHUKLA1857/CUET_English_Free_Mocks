// analyse.js — Vercel Serverless Function
// API endpoint: /api/analyse
// Processes mock test attempt data and returns enriched analytics.
// Called via POST from the front-end after a test is submitted.

/**
 * SECTION METADATA
 * Mirrors the constants in index.html so the server can label and score sections.
 */
const SECTION_LABELS = {
  rc: "Reading Comprehension",
  vocab: "Vocabulary",
  grammar: "Grammar & Error Spotting",
  parajumble: "Para Jumbles",
  idioms: "Idioms & Phrases",
  literary: "Literary Devices & Appreciation",
};

const SCORING = {
  correct: 5,   // +5 per correct answer  (CUET standard)
  wrong: -1,    // -1 per wrong answer
  skipped: 0,
};

/**
 * Compute per-section breakdown from raw attempt data.
 * @param {Object} payload - { answers, timePerQ, questions }
 *   answers   : Array<number|undefined>  – selected option index (0-3) or undefined if skipped
 *   timePerQ  : Array<number>            – seconds spent on each question
 *   questions : Array<{ correct:number, section:string }> – question metadata
 */
function computeSectionStats(payload) {
  const { answers, timePerQ, questions } = payload;

  // Initialise accumulators for every known section
  const sections = {};
  for (const key of Object.keys(SECTION_LABELS)) {
    sections[key] = { correct: 0, wrong: 0, skipped: 0, attempted: 0, total: 0, timeSpent: 0 };
  }

  let totalCorrect = 0;
  let totalWrong = 0;
  let totalSkipped = 0;
  let totalScore = 0;
  let totalTime = 0;

  questions.forEach((q, i) => {
    const sec = q.section;
    if (!sections[sec]) return; // guard against unknown section keys

    const userAns = answers[i];
    const time = timePerQ[i] || 0;

    sections[sec].total += 1;
    sections[sec].timeSpent += time;
    totalTime += time;

    if (userAns === undefined) {
      // Skipped
      sections[sec].skipped += 1;
      totalSkipped += 1;
    } else if (userAns === q.correct) {
      // Correct
      sections[sec].correct += 1;
      sections[sec].attempted += 1;
      totalCorrect += 1;
      totalScore += SCORING.correct;
    } else {
      // Wrong
      sections[sec].wrong += 1;
      sections[sec].attempted += 1;
      totalWrong += 1;
      totalScore += SCORING.wrong;
    }
  });

  return { sections, totalCorrect, totalWrong, totalSkipped, totalScore, totalTime };
}

/**
 * Generate textual insights based on the computed stats.
 */
function generateInsights(sections, totalCorrect, totalWrong, totalSkipped, totalTime, questionCount) {
  const insights = [];
  const avgTimePerQ = questionCount > 0 ? Math.round(totalTime / questionCount) : 0;

  // Accuracy on attempted
  const attempted = totalCorrect + totalWrong;
  const attemptedAcc = attempted > 0 ? Math.round((totalCorrect / attempted) * 100) : 0;

  if (attemptedAcc >= 80) {
    insights.push({ type: "good", text: `Excellent precision! Your accuracy on attempted questions is ${attemptedAcc}%.` });
  } else if (attemptedAcc >= 60) {
    insights.push({ type: "neutral", text: `Decent accuracy of ${attemptedAcc}% on attempted questions. Aim for 80%+.` });
  } else {
    insights.push({ type: "bad", text: `Low accuracy (${attemptedAcc}%) on attempted questions. Avoid random guessing — negative marking (-1) can significantly hurt your score.` });
  }

  // Skip rate
  if (totalSkipped > 15) {
    insights.push({ type: "warn", text: `You skipped ${totalSkipped} questions. Focus on attempting all RC and Para Jumble questions where elimination is possible.` });
  }

  // Time management
  if (avgTimePerQ > 90) {
    insights.push({ type: "warn", text: `Average time per question is ${avgTimePerQ}s — too slow for CUET. Target 60–75s per question overall.` });
  } else if (avgTimePerQ < 20) {
    insights.push({ type: "warn", text: `Average time per question is only ${avgTimePerQ}s. You may be rushing. Double-check your answers.` });
  } else {
    insights.push({ type: "good", text: `Good pace — averaging ${avgTimePerQ}s per question.` });
  }

  // Per-section insights
  for (const [key, data] of Object.entries(sections)) {
    if (data.total === 0) continue;
    const label = SECTION_LABELS[key];
    const acc = data.attempted > 0 ? Math.round((data.correct / data.attempted) * 100) : 0;
    const avgSec = data.total > 0 ? Math.round(data.timeSpent / data.total) : 0;

    if (acc >= 75 && data.attempted > 0) {
      insights.push({ type: "good", text: `Strong in ${label} (${acc}% accuracy). Maintain this level.` });
    } else if (acc < 50 && data.attempted > 0) {
      insights.push({ type: "bad", text: `Weak in ${label} (${acc}% accuracy). Dedicate extra revision to this section.` });
    }

    // Section-specific time tips
    if (key === "rc" && avgSec > 150) {
      insights.push({ type: "warn", text: `RC passages are taking ~${Math.round(avgSec / 60)}m avg per question. Target 6–8 min per full passage (≈90s/question).` });
    }
    if (key === "parajumble" && avgSec > 90) {
      insights.push({ type: "warn", text: `Para Jumbles are taking ~${avgSec}s avg. Target 45–60s each.` });
    }
    if (key === "vocab" && avgSec > 60) {
      insights.push({ type: "warn", text: `Vocabulary questions should take 20–30s. You're averaging ${avgSec}s — review word lists daily.` });
    }
  }

  // General tip
  insights.push({ type: "tip", text: "Tip: Attempt RC and literary questions first — they carry the most questions per section. Leave Para Jumbles for last if you're short on time." });

  return insights;
}

/**
 * Estimate a mock percentile based on score (rough approximation for CUET English).
 * In production, this could be replaced with a real database query.
 */
function estimatePercentile(score) {
  // Score out of 250 (50 questions × 5 marks each)
  // Rough distribution based on CUET English typical performance bands
  if (score >= 220) return 99;
  if (score >= 200) return 97;
  if (score >= 180) return 93;
  if (score >= 160) return 87;
  if (score >= 140) return 78;
  if (score >= 120) return 67;
  if (score >= 100) return 54;
  if (score >= 80)  return 41;
  if (score >= 60)  return 29;
  if (score >= 40)  return 18;
  if (score >= 20)  return 9;
  return 3;
}

// ─────────────────────────────────────────────
// VERCEL SERVERLESS HANDLER
// ─────────────────────────────────────────────
export default function handler(req, res) {
  // CORS pre-flight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  try {
    const payload = req.body;

    // ── Validate required fields ──────────────────
    if (!payload || !Array.isArray(payload.answers) || !Array.isArray(payload.timePerQ) || !Array.isArray(payload.questions)) {
      return res.status(400).json({
        error: "Invalid payload. Expected: { answers: [], timePerQ: [], questions: [{ correct, section }] }",
      });
    }

    if (payload.answers.length !== payload.questions.length) {
      return res.status(400).json({ error: "answers and questions arrays must have the same length." });
    }

    // ── Compute analytics ─────────────────────────
    const { sections, totalCorrect, totalWrong, totalSkipped, totalScore, totalTime } =
      computeSectionStats(payload);

    const questionCount = payload.questions.length;
    const maxScore = questionCount * SCORING.correct;
    const percentageScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    const percentile = estimatePercentile(totalScore);

    const insights = generateInsights(
      sections,
      totalCorrect,
      totalWrong,
      totalSkipped,
      totalTime,
      questionCount
    );

    // ── Build section-level summary array ────────
    const sectionSummary = Object.entries(sections)
      .filter(([, d]) => d.total > 0)
      .map(([key, d]) => ({
        key,
        label: SECTION_LABELS[key] || key,
        total: d.total,
        correct: d.correct,
        wrong: d.wrong,
        skipped: d.skipped,
        attempted: d.attempted,
        accuracy: d.attempted > 0 ? Math.round((d.correct / d.attempted) * 100) : 0,
        avgTimeSeconds: d.total > 0 ? Math.round(d.timeSpent / d.total) : 0,
        score: d.correct * SCORING.correct + d.wrong * SCORING.wrong,
      }));

    // ── Respond ──────────────────────────────────
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      success: true,
      summary: {
        totalQuestions: questionCount,
        attempted: totalCorrect + totalWrong,
        correct: totalCorrect,
        wrong: totalWrong,
        skipped: totalSkipped,
        score: totalScore,
        maxScore,
        percentageScore,
        percentile,
        totalTimeSeconds: totalTime,
        avgTimePerQuestion: questionCount > 0 ? Math.round(totalTime / questionCount) : 0,
      },
      sectionBreakdown: sectionSummary,
      insights,
      scoring: SCORING,
    });
  } catch (err) {
    console.error("[analyse.js] Error:", err);
    return res.status(500).json({ error: "Internal server error.", details: err.message });
  }
}
