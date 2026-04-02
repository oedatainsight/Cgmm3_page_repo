const thresholds = {
  age_group: { warn: 0.12, block: 0.2 },
  payer_type: { warn: 0.1, block: 0.18 },
};

const presets = {
  balanced: {
    subjectId: "buyer-case-001",
    symptomBurden: 0.62,
    adherenceRisk: 0.49,
    accessRisk: 0.38,
    careGapDays: 24,
    ageGroup: "adult",
    payerType: "commercial",
    recentEdVisit: false,
  },
  warn: {
    subjectId: "buyer-case-017",
    symptomBurden: 0.76,
    adherenceRisk: 0.58,
    accessRisk: 0.52,
    careGapDays: 45,
    ageGroup: "adult",
    payerType: "medicaid",
    recentEdVisit: false,
  },
  block: {
    subjectId: "buyer-case-042",
    symptomBurden: 0.95,
    adherenceRisk: 0.84,
    accessRisk: 0.91,
    careGapDays: 77,
    ageGroup: "senior",
    payerType: "medicaid",
    recentEdVisit: true,
  },
};

const state = {
  currentResult: null,
  decisions: [],
  contests: [],
};

const els = {
  subjectId: document.getElementById("subjectId"),
  symptomBurden: document.getElementById("symptomBurden"),
  adherenceRisk: document.getElementById("adherenceRisk"),
  accessRisk: document.getElementById("accessRisk"),
  careGapDays: document.getElementById("careGapDays"),
  ageGroup: document.getElementById("ageGroup"),
  payerType: document.getElementById("payerType"),
  recentEdVisit: document.getElementById("recentEdVisit"),
  generateDecision: document.getElementById("generateDecision"),
  openContest: document.getElementById("openContest"),
  resolveContest: document.getElementById("resolveContest"),
  scoreMetric: document.getElementById("scoreMetric"),
  propensityMetric: document.getElementById("propensityMetric"),
  ciMetric: document.getElementById("ciMetric"),
  contestMetric: document.getElementById("contestMetric"),
  gateBadge: document.getElementById("gateBadge"),
  resultBanner: document.getElementById("resultBanner"),
  resultHeadline: document.getElementById("resultHeadline"),
  resultCopy: document.getElementById("resultCopy"),
  checksCaption: document.getElementById("checksCaption"),
  checksList: document.getElementById("checksList"),
  receiptJson: document.getElementById("receiptJson"),
  auditTrail: document.getElementById("auditTrail"),
  symptomBurdenOutput: document.getElementById("symptomBurdenOutput"),
  adherenceRiskOutput: document.getElementById("adherenceRiskOutput"),
  accessRiskOutput: document.getElementById("accessRiskOutput"),
  careGapDaysOutput: document.getElementById("careGapDaysOutput"),
};

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ageFactor(ageGroup) {
  return {
    pediatric: 0.04,
    adult: 0.02,
    senior: 0.08,
  }[ageGroup] ?? 0.03;
}

function payerFactor(payerType) {
  return {
    commercial: 0.02,
    medicaid: 0.07,
    uninsured: 0.1,
  }[payerType] ?? 0.04;
}

function createReceiptId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `receipt-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function readFormState() {
  return {
    subjectId: els.subjectId.value.trim() || "buyer-case-001",
    symptomBurden: Number(els.symptomBurden.value),
    adherenceRisk: Number(els.adherenceRisk.value),
    accessRisk: Number(els.accessRisk.value),
    careGapDays: Number(els.careGapDays.value),
    ageGroup: els.ageGroup.value,
    payerType: els.payerType.value,
    recentEdVisit: els.recentEdVisit.checked,
  };
}

function calculateDecision(input) {
  const normalizedGap = clamp(input.careGapDays / 90, 0, 1);
  const eventFactor = input.recentEdVisit ? 0.12 : 0;
  const score = round(
    clamp(
      0.34 * input.symptomBurden +
        0.22 * input.adherenceRisk +
        0.18 * input.accessRisk +
        0.16 * normalizedGap +
        eventFactor +
        ageFactor(input.ageGroup) +
        payerFactor(input.payerType),
      0.01,
      0.99
    )
  );
  const ciHalfWidth = clamp(0.1 + 0.18 * input.accessRisk + 0.08 * Math.abs(score - 0.5), 0.1, 0.42);
  const ciLow = round(score - ciHalfWidth);
  const ciHigh = round(score + ciHalfWidth);
  const propensityScore = round(clamp(0.18 + 0.58 * score + (input.recentEdVisit ? 0.08 : 0), 0.05, 0.95));

  const subgroupGaps = {
    age_group: round(clamp(0.03 + 0.1 * input.symptomBurden + ageFactor(input.ageGroup), 0.02, 0.22), 3),
    payer_type: round(clamp(0.03 + 0.12 * input.accessRisk + payerFactor(input.payerType), 0.02, 0.24), 3),
  };

  let recommendation;
  let nextBestAction;
  let pipelineGateStatus;

  if (score >= 0.8 || (input.recentEdVisit && input.accessRisk >= 0.8)) {
    recommendation = "Escalate to human review immediately; do not auto-enroll without clinician confirmation.";
    nextBestAction = "Human escalation";
    pipelineGateStatus = "BLOCK";
  } else if (score >= 0.58) {
    recommendation = "Route to nurse outreach within 24 hours and schedule a medication adherence check.";
    nextBestAction = "Governed outreach";
    pipelineGateStatus = "WARN";
  } else {
    recommendation = "Proceed with standard follow-up and a 14-day reassessment.";
    nextBestAction = "Standard follow-up";
    pipelineGateStatus = "PASS";
  }

  const fairnessWarnings = [];
  const fairnessBlocks = [];

  Object.entries(subgroupGaps).forEach(([name, value]) => {
    if (value > thresholds[name].block) {
      fairnessBlocks.push(`${name} gap (${value} > ${thresholds[name].block})`);
    } else if (value > thresholds[name].warn) {
      fairnessWarnings.push(`${name} gap (${value} > ${thresholds[name].warn})`);
    }
  });

  let gateStatus = pipelineGateStatus;
  const warnings = [];
  const blocks = [];

  if (fairnessWarnings.length > 0) {
    warnings.push(`Equity concern: ${fairnessWarnings.join("; ")}.`);
  }

  if (fairnessBlocks.length > 0) {
    blocks.push(`Fairness block: ${fairnessBlocks.join("; ")}.`);
    gateStatus = "BLOCK";
  } else if (gateStatus === "PASS" && fairnessWarnings.length > 0) {
    gateStatus = "WARN";
  }

  if (pipelineGateStatus === "BLOCK") {
    blocks.unshift("System gate is BLOCK - recommendations suppressed.");
  }

  const ciWidth = round(ciHigh - ciLow, 3);

  const checks = [
    {
      name: "deployment_gate",
      passed: pipelineGateStatus !== "BLOCK",
      value: pipelineGateStatus,
      threshold: "PASS or WARN",
      message:
        pipelineGateStatus === "BLOCK"
          ? "System gate is BLOCK - recommendations suppressed."
          : `System gate is ${pipelineGateStatus} - recommendation release is permitted.`,
    },
    {
      name: "positivity_overlap",
      passed: propensityScore >= 0.05 && propensityScore <= 0.95,
      value: propensityScore,
      threshold: "[0.05, 0.95]",
      message:
        propensityScore >= 0.05 && propensityScore <= 0.95
          ? "Score is within overlap support."
          : "Score falls outside overlap support.",
    },
    {
      name: "score_magnitude_plausibility",
      passed: score >= 0.05 && score <= 5,
      value: score,
      threshold: "[0.05, 5.0]",
      message: "Score falls within plausible range.",
    },
    {
      name: "confidence_interval_width",
      passed: ciWidth <= 3,
      value: ciWidth,
      threshold: 3,
      message: `CI width (${ciWidth}) is within bounds.`,
    },
    {
      name: "subgroup_equity",
      passed: fairnessWarnings.length === 0 && fairnessBlocks.length === 0,
      value: subgroupGaps,
      threshold: {
        age_group: thresholds.age_group.warn,
        payer_type: thresholds.payer_type.warn,
      },
      message:
        fairnessWarnings.length === 0 && fairnessBlocks.length === 0
          ? "Subgroup gaps remain within configured governance thresholds."
          : `Equity concern: ${[...fairnessWarnings, ...fairnessBlocks].join("; ")}.`,
    },
  ];

  const displayRecommendation = gateStatus === "BLOCK" ? null : recommendation;
  const timestamp = new Date().toISOString();
  const receipt = {
    receipt_id: createReceiptId(),
    timestamp,
    subject_id: input.subjectId,
    gate_status: gateStatus,
    recommendation: displayRecommendation,
    score,
    confidence_interval: [ciLow, ciHigh],
    checks,
    warnings,
    blocks,
    assumptions: [
      "This static site mirrors the demo heuristics used in the repository's buyer-facing surface.",
      "Governance runs before the recommendation is treated as a visible release action.",
      "Sensitive attributes are treated as audit dimensions, not as required production features.",
    ],
    oversight_contacts: ["governance@cgmm3-govern.io", "clinical-safety@cgmm3-govern.io"],
    contestability_url: "mailto:governance@cgmm3-govern.io",
    model_id: "care-coordination-agent",
    model_version: "buyer-demo-v1",
  };

  return {
    input,
    recommendation,
    nextBestAction,
    pipelineGateStatus,
    gateStatus,
    displayRecommendation,
    score,
    ciLow,
    ciHigh,
    ciWidth,
    propensityScore,
    subgroupGaps,
    warnings,
    blocks,
    checks,
    receipt,
  };
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function renderChecks(checks) {
  const passedCount = checks.filter((check) => check.passed).length;
  els.checksCaption.textContent = `${passedCount} of ${checks.length} checks passed`;
  els.checksList.innerHTML = checks
    .map((check) => {
      const statusLabel = check.passed ? "Pass" : "Review";
      return `
        <li class="check-item">
          <header>
            <span>${check.name}</span>
            <span>${statusLabel}</span>
          </header>
          <p>${check.message}</p>
        </li>
      `;
    })
    .join("");
}

function renderAuditTrail() {
  const openContests = state.contests.filter((contest) => contest.status === "open");
  els.contestMetric.textContent = String(openContests.length);

  const entries = [];

  state.decisions.slice(0, 4).forEach((decision) => {
    entries.push(`
      <article class="audit-entry">
        <header>
          <span>Decision ${decision.receipt.receipt_id}</span>
          <span>${decision.gateStatus}</span>
        </header>
        <p>${decision.displayRecommendation ?? "Suppressed by governance."}</p>
      </article>
    `);
  });

  state.contests.slice(0, 4).forEach((contest) => {
    entries.push(`
      <article class="audit-entry">
        <header>
          <span>Contest ${contest.contestId}</span>
          <span>${contest.status}</span>
        </header>
        <p>${contest.reason}</p>
      </article>
    `);
  });

  els.auditTrail.innerHTML = entries.length > 0 ? entries.join("") : '<div class="audit-empty">Generate a governed decision to start the trail.</div>';
}

function renderResult(result) {
  state.currentResult = result;
  state.decisions.unshift(result);
  state.decisions = state.decisions.slice(0, 8);

  els.scoreMetric.textContent = formatNumber(result.score);
  els.propensityMetric.textContent = formatNumber(result.propensityScore);
  els.ciMetric.textContent = formatNumber(result.ciWidth, 3);

  els.gateBadge.className = `gate-pill gate-pill-${result.gateStatus.toLowerCase()}`;
  els.gateBadge.textContent = result.gateStatus;
  els.resultBanner.className = `result-banner result-${result.gateStatus.toLowerCase()}`;

  if (result.gateStatus === "BLOCK") {
    els.resultHeadline.textContent = "Recommendation suppressed pending manual review.";
    els.resultCopy.textContent = result.blocks.join(" ");
  } else {
    els.resultHeadline.textContent = result.displayRecommendation;
    els.resultCopy.textContent =
      result.warnings.length > 0
        ? result.warnings.join(" ")
        : "The action is visible because governance found no blocking conditions.";
  }

  renderChecks(result.checks);
  els.receiptJson.textContent = JSON.stringify(result.receipt, null, 2);
  renderAuditTrail();
}

function syncRangeOutputs() {
  els.symptomBurdenOutput.textContent = formatNumber(els.symptomBurden.value);
  els.adherenceRiskOutput.textContent = formatNumber(els.adherenceRisk.value);
  els.accessRiskOutput.textContent = formatNumber(els.accessRisk.value);
  els.careGapDaysOutput.textContent = els.careGapDays.value;
}

function applyPreset(presetName) {
  const preset = presets[presetName];
  if (!preset) {
    return;
  }

  els.subjectId.value = preset.subjectId;
  els.symptomBurden.value = preset.symptomBurden;
  els.adherenceRisk.value = preset.adherenceRisk;
  els.accessRisk.value = preset.accessRisk;
  els.careGapDays.value = preset.careGapDays;
  els.ageGroup.value = preset.ageGroup;
  els.payerType.value = preset.payerType;
  els.recentEdVisit.checked = preset.recentEdVisit;
  syncRangeOutputs();

  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === presetName);
  });
}

function openContest() {
  if (!state.currentResult) {
    return;
  }

  const receiptId = state.currentResult.receipt.receipt_id;
  const existingOpenContest = state.contests.find(
    (contest) => contest.receiptId === receiptId && contest.status === "open"
  );

  if (existingOpenContest) {
    renderAuditTrail();
    return;
  }

  state.contests.unshift({
    contestId: `contest-${Date.now()}`,
    receiptId,
    reason: state.currentResult.gateStatus === "BLOCK"
      ? "Supervisor requests manual review of the blocked action."
      : "Operations review requested for a warned recommendation.",
    status: "open",
  });
  state.contests = state.contests.slice(0, 8);
  renderAuditTrail();
}

function resolveLatestContest() {
  const openContestEntry = state.contests.find((contest) => contest.status === "open");
  if (!openContestEntry) {
    return;
  }

  openContestEntry.status = "resolved";
  openContestEntry.reason = `${openContestEntry.reason} Resolution: upheld after reviewer confirmation.`;
  renderAuditTrail();
}

document.querySelectorAll(".preset-button").forEach((button) => {
  button.addEventListener("click", () => {
    applyPreset(button.dataset.preset);
    renderResult(calculateDecision(readFormState()));
  });
});

[els.symptomBurden, els.adherenceRisk, els.accessRisk, els.careGapDays].forEach((input) => {
  input.addEventListener("input", syncRangeOutputs);
});

els.generateDecision.addEventListener("click", () => {
  renderResult(calculateDecision(readFormState()));
});

els.openContest.addEventListener("click", openContest);
els.resolveContest.addEventListener("click", resolveLatestContest);

applyPreset("balanced");
renderResult(calculateDecision(readFormState()));