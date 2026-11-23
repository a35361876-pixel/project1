import {
  CurvePoint,
  Difficulty,
  ExamItemEvaluation,
  ExamOptimizationPlan,
  LearningCluster,
  MLPForwardResult,
  MLPWeights,
  ReviewOutcome,
  StudyCard,
  TrainingLogEntry,
} from '../types';

export const BASELINE_K = 3.2; // Standard Ebbinghaus decay constant k in R = e^(-t/k)
export const RETENTION_THRESHOLD = 0.7; // 70% Golden Time line
export const MAX_DAYS = 14;
export const LEARNING_RATE = 0.36;

/**
 * Stage 1: Standard Ebbinghaus Forgetting Curve R_base(t) = e^(-t / k)
 */
export function calculateBaselineRetention(elapsedDays: number): number {
  const safeT = Math.max(0, elapsedDays);
  return Math.exp(-safeT / BASELINE_K);
}

export function calculateBaselineOptimalDays(): number {
  return -BASELINE_K * Math.log(RETENTION_THRESHOLD);
}

export function formatDurationKorean(days: number): string {
  const absHours = Math.round(Math.abs(days) * 24);
  if (absHours < 1) return '1시간 미만';
  if (absHours < 24) return `${absHours}시간`;
  const d = Math.floor(absHours / 24);
  const h = absHours % 24;
  return h > 0 ? `${d}일 ${h}시간` : `${d}일`;
}

export interface ReviewDeadlineInfo {
  isOverdue: boolean;
  /** Full Korean deadline, e.g. "오늘 오후 11시 20분까지" or "11월 24일 (화) 오전 9시 15분까지" */
  headline: string;
  /** Short compact deadline, e.g. "오늘 23:20까지" or "11/24 09:15까지" */
  compact: string;
  /** Relative guidance text, e.g. "앞으로 18시간 안에 복습" */
  sublabel: string;
  /** Exact target Date object */
  targetDate: Date;
}

export function formatReviewDeadline(
  optimalDay: number,
  elapsedDays: number,
  now: Date = new Date()
): ReviewDeadlineInfo {
  const remainingDays = optimalDay - elapsedDays;
  const targetMs = now.getTime() + remainingDays * 24 * 60 * 60 * 1000;
  const targetDate = new Date(targetMs);

  const month = targetDate.getMonth() + 1;
  const date = targetDate.getDate();
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const weekday = weekdays[targetDate.getDay()];

  const hour24 = targetDate.getHours();
  const minute = targetDate.getMinutes();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const period = hour24 < 12 ? '오전' : '오후';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const timeKor = minute === 0 ? `${period} ${hour12}시` : `${period} ${hour12}시 ${minute}분`;
  const time24 = `${pad2(hour24)}:${pad2(minute)}`;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate()
  ).getTime();
  const dayDiff = Math.round((targetStart - todayStart) / (24 * 60 * 60 * 1000));

  const dayPrefixFull =
    dayDiff === 0
      ? '오늘'
      : dayDiff === 1
        ? `내일(${month}/${date})`
        : `${month}월 ${date}일(${weekday})`;
  const dayPrefixShort =
    dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : `${month}/${date}`;

  if (remainingDays <= 0) {
    const overdueDays = Math.abs(remainingDays);
    return {
      isOverdue: true,
      headline: '지금 바로 복습 필요',
      compact: '지금 바로 복습',
      sublabel:
        overdueDays < 1 / 24
          ? '방금 골든타임 도달'
          : `권장 시점(${dayPrefixShort} ${time24}) ${formatDurationKorean(overdueDays)} 지남`,
      targetDate,
    };
  }

  return {
    isOverdue: false,
    headline: `${dayPrefixFull} ${timeKor} 안에`,
    compact: `${dayPrefixShort} ${time24}까지`,
    sublabel: `지금부터 ${formatDurationKorean(remainingDays)} 이내 복습`,
    targetDate,
  };
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatKoreanClock(date: Date): { timeKor: string; time24: string } {
  const hour24 = date.getHours();
  const minute = date.getMinutes();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const period = hour24 < 12 ? '오전' : '오후';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const timeKor = minute === 0 ? `${period} ${hour12}시` : `${period} ${hour12}시 ${minute}분`;
  const time24 = `${pad2(hour24)}:${pad2(minute)}`;
  return { timeKor, time24 };
}

export interface ScheduledReviewItem {
  card: StudyCard;
  optimalDay: number;
  aiRetentionPct: number;
  deadline: ReviewDeadlineInfo;
  /** Calendar date bucket: overdue items are anchored on today so the user sees what to review today */
  calendarDate: Date;
  dateKey: string;
  time24: string;
  timeKor: string;
  isToday: boolean;
  isOverdue: boolean;
}

export function buildReviewSchedule(
  cards: StudyCard[],
  weights: MLPWeights,
  now: Date = new Date()
): ScheduledReviewItem[] {
  const todayKey = toDateKey(now);

  return cards
    .map((card) => {
      const curvePts = generateCurvePoints(weights, card, 70);
      const optimalDay = findOptimalReviewDay(curvePts);
      const { aiRetention } = getCardRetentionAtDay(weights, card, card.elapsedDays);
      const deadline = formatReviewDeadline(optimalDay, card.elapsedDays, now);
      const calendarDate = deadline.isOverdue ? now : deadline.targetDate;
      const dateKey = toDateKey(calendarDate);
      const { timeKor, time24 } = formatKoreanClock(deadline.targetDate);

      return {
        card,
        optimalDay,
        aiRetentionPct: aiRetention * 100,
        deadline,
        calendarDate,
        dateKey,
        time24,
        timeKor,
        isToday: dateKey === todayKey,
        isOverdue: deadline.isOverdue,
      };
    })
    .sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return a.deadline.targetDate.getTime() - b.deadline.targetDate.getTime();
    });
}

export interface ClusterProfile {
  id: LearningCluster;
  label: string;
  shortLabel: string;
  /** Initial cold-start residual bias before personal review logs dominate */
  coldStartPrior: number;
  /** Additional retention boost per review after mastering structure */
  repetitionGain: number;
  /** Default estimated minutes needed to review one card in this cluster */
  defaultMinutes: number;
  description: string;
  decaySignature: string;
}

export const CLUSTER_PROFILES: Record<LearningCluster, ClusterProfile> = {
  vocab: {
    id: 'vocab',
    label: '암기·어휘 군집',
    shortLabel: '암기·어휘',
    coldStartPrior: -0.14,
    repetitionGain: 0.08,
    defaultMinutes: 8,
    description: '단어·연표·고유명사 등 단순 인출 비중이 높아 초기 망각이 빠른 유형',
    decaySignature: '초기 급락형 (초기 보정 -14% 가중 → 빠른 1차 복습 권장)',
  },
  concept: {
    id: 'concept',
    label: '이해·개념 군집',
    shortLabel: '이해·개념',
    coldStartPrior: 0.04,
    repetitionGain: 0.06,
    defaultMinutes: 12,
    description: '인과관계·과학 원리 등 맥락 연결이 가능해 표준 곡선과 유사하거나 완만한 유형',
    decaySignature: '표준 완만형 (초기 보정 +4% 가중 → 원리 중심 유지)',
  },
  formula: {
    id: 'formula',
    label: '수식·문제풀이 군집',
    shortLabel: '수식·문제풀이',
    coldStartPrior: -0.08,
    repetitionGain: 0.14,
    defaultMinutes: 18,
    description: '초기 부호화 부하는 높지만 1~2회 문제 적용 후 장기 기억 고정 폭이 큰 유형',
    decaySignature: '반복 도약형 (초기 -8% → 반복 시 장기 유지 보너스)',
  },
};

export function inferCardCluster(
  card: Pick<StudyCard, 'cluster' | 'subject' | 'title' | 'note'>
): LearningCluster {
  if (card.cluster && CLUSTER_PROFILES[card.cluster]) {
    return card.cluster;
  }
  const text = `${card.title ?? ''} ${card.note ?? ''}`.toLowerCase();
  if (
    card.subject === '수학' ||
    /[=+\-*/^√∫∑]|법칙|공식|방정식|함수|미분|적분|벡터|몰농도/.test(text)
  ) {
    return 'formula';
  }
  if (
    card.subject === '영어' ||
    /어휘|단어|연표|조항|숙어|암기|ubiquitous|ephemeral|1894|갑오/.test(text)
  ) {
    return 'vocab';
  }
  return 'concept';
}

export function getCardEstimatedMinutes(card: Pick<StudyCard, 'estimatedMinutes' | 'cluster' | 'subject' | 'title' | 'note'>): number {
  if (typeof card.estimatedMinutes === 'number' && card.estimatedMinutes >= 1) {
    return Math.round(card.estimatedMinutes);
  }
  const cluster = inferCardCluster(card);
  return CLUSTER_PROFILES[cluster].defaultMinutes;
}

export function getDifficultyLabel(difficulty: Difficulty): string {
  switch (difficulty) {
    case 1:
      return '쉬움';
    case 2:
      return '보통';
    case 3:
      return '어려움';
  }
}

export function getOutcomeScore(outcome: ReviewOutcome | null): number {
  if (outcome === 'remembered') return 1.0;
  if (outcome === 'forgotten') return 0.0;
  return 0.5; // neutral / confused
}

export function getOutcomeLabel(outcome: ReviewOutcome): string {
  switch (outcome) {
    case 'remembered':
      return '완벽히 기억남';
    case 'confused':
      return '헷갈림';
    case 'forgotten':
      return '잊어버림';
  }
}

/**
 * Calibrated 4 -> 4 (ReLU) -> 1 (tanh) Residual MLP initial weights.
 * Inputs:
 *   x1 = t / 14 (elapsed time normalized)
 *   x2 = (difficulty - 1) / 2 (0: easy, 0.5: medium, 1: hard)
 *   x3 = review outcome score (1: remembered, 0.5: confused, 0: forgotten)
 *   x4 = min(reviewCount / 5, 1) (cumulative reviews normalized)
 */
export function createInitialWeights(): MLPWeights {
  const w1: number[][] = [
    [0.14, -0.12, 0.18, -0.10], // x1: elapsed time
    [-0.22, 0.28, -0.20, 0.24], // x2: difficulty
    [0.42, -0.34, 0.38, -0.28], // x3: test outcome
    [0.26, -0.16, 0.24, -0.14], // x4: review count
  ];
  const b1: number[] = [0.18, 0.26, 0.16, 0.24];
  const w2: number[] = [0.46, -0.44, 0.42, -0.38];

  // Calibrate b2 so neutral cold-start card (x2=0.5, x3=0.5, x4=0) at t=2d gives ~0 residual
  const neutralProbe: [number, number, number, number] = [2 / MAX_DAYS, 0.5, 0.5, 0];
  let weightedSum = 0;
  for (let j = 0; j < 4; j++) {
    let z = b1[j];
    for (let i = 0; i < 4; i++) {
      z += w1[i][j] * neutralProbe[i];
    }
    weightedSum += w2[j] * Math.max(0, z);
  }

  return {
    w1,
    b1,
    w2,
    b2: Number((-weightedSum).toFixed(6)),
  };
}

function relu(x: number): number {
  return x > 0 ? x : 0;
}

export function normalizeMLPInputs(
  elapsedDays: number,
  difficulty: Difficulty,
  outcome: ReviewOutcome | null,
  reviewCount: number
): [number, number, number, number] {
  const x1 = Math.min(Math.max(elapsedDays / MAX_DAYS, 0), 1);
  const x2 = (difficulty - 1) / 2;
  const x3 = getOutcomeScore(outcome);
  const x4 = Math.min(Math.max(reviewCount / 5, 0), 1);
  return [
    Number(x1.toFixed(4)),
    Number(x2.toFixed(4)),
    Number(x3.toFixed(4)),
    Number(x4.toFixed(4)),
  ];
}

/**
 * Forward pass through 4 -> 4 (ReLU) -> 1 (tanh) Residual MLP
 */
export function forwardMLP(
  weights: MLPWeights,
  inputs: [number, number, number, number]
): MLPForwardResult {
  const z1: [number, number, number, number] = [0, 0, 0, 0];
  const hidden: [number, number, number, number] = [0, 0, 0, 0];

  for (let j = 0; j < 4; j++) {
    let sum = weights.b1[j];
    for (let i = 0; i < 4; i++) {
      sum += weights.w1[i][j] * inputs[i];
    }
    z1[j] = sum;
    hidden[j] = relu(sum);
  }

  let z2 = weights.b2;
  for (let j = 0; j < 4; j++) {
    z2 += weights.w2[j] * hidden[j];
  }

  const output = Math.tanh(Math.max(-6, Math.min(6, z2)));

  return {
    inputs,
    z1,
    hidden,
    z2,
    output,
  };
}

/**
 * Compute Cluster Cold-Start Prior Offset so newly added cards reflect
 * realistic cluster decay before personal backpropagation updates accumulate.
 */
export function computeClusterColdStartOffset(
  card: Pick<StudyCard, 'reviewCount' | 'cluster' | 'subject' | 'title' | 'note'>
): number {
  const cluster = inferCardCluster(card);
  const profile = CLUSTER_PROFILES[cluster];
  // Prior dominates when reviewCount=0 and smoothly yields to personalized MLP weights over reviews
  const coldWeight = Math.exp(-card.reviewCount * 0.65);
  const masteryBonus =
    card.reviewCount > 0 ? profile.repetitionGain * (1 - coldWeight) : 0;
  return profile.coldStartPrior * coldWeight + masteryBonus;
}

/**
 * Compute unresolved weakness residual drag so cards with remaining blank-page
 * misconceptions/gaps curve downward and trigger earlier review deadlines,
 * while resolving weaknesses lifts the curve back up.
 */
export function computeWeaknessResidualOffset(
  card: Pick<StudyCard, 'unresolvedWeaknessCount' | 'weaknessSeverityScore'>
): number {
  const count = Math.max(0, Number(card.unresolvedWeaknessCount ?? 0));
  const severity =
    typeof card.weaknessSeverityScore === 'number' && card.weaknessSeverityScore > 0
      ? card.weaknessSeverityScore
      : count;
  if (count === 0 && severity <= 0) return 0;
  return -Math.min(0.45, severity * 0.11);
}

/**
 * Stage 2: Convert raw MLP output in (-1, 1) + cluster prior + weakness drag into retention residual ΔR(t)
 * Boundary conditions: ΔR(0) = 0 (at t=0 memory is 100%), scales smoothly over time
 */
export function computeResidualAtDay(
  weights: MLPWeights,
  day: number,
  card: Pick<
    StudyCard,
    | 'difficulty'
    | 'lastOutcome'
    | 'reviewCount'
    | 'cluster'
    | 'subject'
    | 'title'
    | 'note'
    | 'unresolvedWeaknessCount'
    | 'weaknessSeverityScore'
  >
): number {
  if (day <= 0) return 0;
  const inputs = normalizeMLPInputs(day, card.difficulty, card.lastOutcome, card.reviewCount);
  const { output } = forwardMLP(weights, inputs);
  const clusterOffset = computeClusterColdStartOffset(card);
  const weaknessOffset = computeWeaknessResidualOffset(card);
  const combinedSignal = Math.max(-1, Math.min(1, output + clusterOffset + weaknessOffset));
  const baseR = calculateBaselineRetention(day);
  // Time rise envelope so curve smoothly departs from (0, 100%) and decays at large t
  const timeEnvelope = 1 - Math.exp(-day / 0.85);
  const decaySupport = 0.25 + 0.75 * baseR;
  return combinedSignal * 0.34 * timeEnvelope * decaySupport;
}

/**
 * Generate 0..14 day comparison curve points for a specific card,
 * enforcing smooth monotonic decay for realistic forgetting curves.
 */
export function generateCurvePoints(
  weights: MLPWeights,
  card: Pick<
    StudyCard,
    | 'difficulty'
    | 'lastOutcome'
    | 'reviewCount'
    | 'cluster'
    | 'subject'
    | 'title'
    | 'note'
    | 'unresolvedWeaknessCount'
    | 'weaknessSeverityScore'
  >,
  steps = 70
): CurvePoint[] {
  const points: CurvePoint[] = [];
  let prevAi = 1.0;

  for (let i = 0; i <= steps; i++) {
    const day = (i / steps) * MAX_DAYS;
    const baseRetention = calculateBaselineRetention(day);
    const rawDelta = computeResidualAtDay(weights, day, card);
    const candidateAi = Math.max(0.01, Math.min(1.0, baseRetention + rawDelta));
    const aiRetention = i === 0 ? 1.0 : Math.min(prevAi, candidateAi);
    prevAi = aiRetention;

    points.push({
      day,
      baseRetention,
      aiRetention,
      residualDelta: aiRetention - baseRetention,
    });
  }

  return points;
}

/**
 * Find the intersection day where AI-corrected curve crosses 70% retention threshold
 */
export function findOptimalReviewDay(points: CurvePoint[]): number {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.aiRetention >= RETENTION_THRESHOLD && curr.aiRetention <= RETENTION_THRESHOLD) {
      const denom = prev.aiRetention - curr.aiRetention;
      const ratio = denom > 1e-6 ? (prev.aiRetention - RETENTION_THRESHOLD) / denom : 0;
      const day = prev.day + ratio * (curr.day - prev.day);
      return Number(day.toFixed(2));
    }
  }
  return points[points.length - 1]?.aiRetention > RETENTION_THRESHOLD ? MAX_DAYS : 0.2;
}

export function getCardRetentionAtDay(
  weights: MLPWeights,
  card: Pick<
    StudyCard,
    | 'difficulty'
    | 'lastOutcome'
    | 'reviewCount'
    | 'cluster'
    | 'subject'
    | 'title'
    | 'note'
    | 'unresolvedWeaknessCount'
    | 'weaknessSeverityScore'
  >,
  targetDay: number
): { baseRetention: number; aiRetention: number; residualDelta: number } {
  const points = generateCurvePoints(weights, card, 140);
  const clampedDay = Math.max(0, Math.min(MAX_DAYS, targetDay));
  const idx = Math.min(
    points.length - 1,
    Math.round((clampedDay / MAX_DAYS) * (points.length - 1))
  );
  const pt = points[idx];
  return {
    baseRetention: pt.baseRetention,
    aiRetention: pt.aiRetention,
    residualDelta: pt.residualDelta,
  };
}

export interface WeaknessTrainingStats {
  unresolvedCount: number;
  highSeverityCount: number;
  resolvedInRetryCount?: number;
  isWeaknessRetry?: boolean;
}

/**
 * Perform one real Gradient Descent (Backpropagation) update on the 4-4-1 Residual MLP
 */
export function trainResidualMLPStep(
  currentWeights: MLPWeights,
  card: StudyCard,
  outcome: ReviewOutcome,
  difficulty: Difficulty,
  retrievalScore0to100?: number,
  weaknessStats?: WeaknessTrainingStats
): {
  updatedWeights: MLPWeights;
  updatedCard: StudyCard;
  logEntry: TrainingLogEntry;
} {
  const nextReviewCount = card.reviewCount + 1;
  const evalDay = Math.max(0.5, card.elapsedDays);

  const pointsBefore = generateCurvePoints(currentWeights, card, 70);
  const optimalDayBefore = findOptimalReviewDay(pointsBefore);
  const residualBeforeAt1d = getCardRetentionAtDay(currentWeights, card, 1.0).residualDelta * 100;

  const weaknessPenalty = weaknessStats
    ? Math.min(
        0.55,
        weaknessStats.unresolvedCount * 0.09 + weaknessStats.highSeverityCount * 0.08
      )
    : 0;
  const retryRecoveryBonus = weaknessStats
    ? weaknessStats.isWeaknessRetry &&
      (weaknessStats.resolvedInRetryCount ?? 0) > 0 &&
      weaknessStats.unresolvedCount === 0
      ? 0.16
      : (weaknessStats.resolvedInRetryCount ?? 0) * 0.04
    : 0;

  const baseInputs = normalizeMLPInputs(evalDay, difficulty, outcome, nextReviewCount);
  const inputs: [number, number, number, number] =
    typeof retrievalScore0to100 === 'number'
      ? [
          baseInputs[0],
          baseInputs[1],
          Number(
            Math.max(
              0,
              Math.min(
                1,
                retrievalScore0to100 / 100 - weaknessPenalty * 0.35 + retryRecoveryBonus * 0.25
              )
            ).toFixed(4)
          ),
          baseInputs[3],
        ]
      : baseInputs;
  const forward = forwardMLP(currentWeights, inputs);
  const yPred = forward.output;

  // Target residual signal in (-1, 1)
  let target: number;
  if (typeof retrievalScore0to100 === 'number') {
    const clampedScore = Math.max(0, Math.min(100, retrievalScore0to100));
    const scoreSignal = ((clampedScore - 50) / 50) * 0.72;
    const diffAdj = difficulty === 1 ? 0.08 : difficulty === 3 ? -0.1 : 0;
    target = Math.max(
      -0.92,
      Math.min(0.92, scoreSignal + diffAdj - weaknessPenalty + retryRecoveryBonus)
    );
  } else if (outcome === 'remembered') {
    const diffBoost = difficulty === 1 ? 0.14 : difficulty === 3 ? 0.04 : 0.09;
    target = Math.min(0.9, Math.max(yPred + 0.28, 0.56 + diffBoost));
  } else if (outcome === 'confused') {
    target = difficulty === 3 ? -0.18 : 0.04;
  } else {
    const diffPenalty = difficulty === 3 ? -0.18 : difficulty === 2 ? -0.10 : -0.04;
    target = Math.max(-0.9, Math.min(yPred - 0.28, -0.52 + diffPenalty));
  }

  // MSE Loss: L = 0.5 * (yPred - target)^2
  const loss = 0.5 * Math.pow(yPred - target, 2);

  // Output layer gradient with tanh derivative: d(tanh(z))/dz = 1 - yPred^2
  const dLossDz2 = (yPred - target) * (1 - yPred * yPred);

  const gradW2 = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) {
    gradW2[j] = dLossDz2 * forward.hidden[j];
  }
  const gradB2 = dLossDz2;

  const dLossDz1 = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) {
    const reluDeriv = forward.z1[j] > 0 ? 1 : 0;
    dLossDz1[j] = dLossDz2 * currentWeights.w2[j] * reluDeriv;
  }

  const gradW1: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const gradB1 = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) {
    gradB1[j] = dLossDz1[j];
    for (let i = 0; i < 4; i++) {
      gradW1[i][j] = dLossDz1[j] * inputs[i];
    }
  }

  const deltaW1: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const newW1 = currentWeights.w1.map((row, i) =>
    row.map((val, j) => {
      const delta = -LEARNING_RATE * gradW1[i][j];
      deltaW1[i][j] = Number(delta.toFixed(5));
      return Number((val + delta).toFixed(5));
    })
  );
  const newB1 = currentWeights.b1.map((val, j) =>
    Number((val - LEARNING_RATE * gradB1[j]).toFixed(5))
  );

  const deltaW2 = [0, 0, 0, 0];
  const newW2 = currentWeights.w2.map((val, j) => {
    const delta = -LEARNING_RATE * gradW2[j];
    deltaW2[j] = Number(delta.toFixed(5));
    return Number((val + delta).toFixed(5));
  });
  const newB2 = Number((currentWeights.b2 - LEARNING_RATE * gradB2).toFixed(5));

  const updatedWeights: MLPWeights = {
    w1: newW1,
    b1: newB1,
    w2: newW2,
    b2: newB2,
  };

  const updatedSeverityScore = weaknessStats
    ? Number(
        (
          weaknessStats.highSeverityCount * 1.4 +
          Math.max(0, weaknessStats.unresolvedCount - weaknessStats.highSeverityCount) * 0.8
        ).toFixed(2)
      )
    : card.weaknessSeverityScore;

  const updatedCard: StudyCard = {
    ...card,
    difficulty,
    lastOutcome: outcome,
    reviewCount: nextReviewCount,
    elapsedDays: 0,
    unresolvedWeaknessCount: weaknessStats
      ? weaknessStats.unresolvedCount
      : card.unresolvedWeaknessCount,
    weaknessSeverityScore: updatedSeverityScore,
    lastReviewedAt:
      typeof retrievalScore0to100 === 'number'
        ? weaknessStats?.isWeaknessRetry
          ? `약점 재도전 (${Math.round(retrievalScore0to100)}점)`
          : `백지 인출 완료 (${Math.round(retrievalScore0to100)}점)`
        : '방금 복습 완료',
  };

  const forwardAfter = forwardMLP(updatedWeights, inputs);
  const pointsAfter = generateCurvePoints(updatedWeights, updatedCard, 70);
  const optimalDayAfter = findOptimalReviewDay(pointsAfter);
  const residualAfterAt1d =
    getCardRetentionAtDay(updatedWeights, updatedCard, 1.0).residualDelta * 100;

  const logEntry: TrainingLogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    cardId: card.id,
    cardTitle: card.title,
    subject: card.subject,
    outcome,
    difficulty,
    elapsedDays: Number(card.elapsedDays.toFixed(2)),
    reviewCountAfter: nextReviewCount,
    inputs,
    hiddenActivations: forward.hidden.map((h) => Number(h.toFixed(3))) as [
      number,
      number,
      number,
      number,
    ],
    outputBefore: Number(forward.output.toFixed(4)),
    outputAfter: Number(forwardAfter.output.toFixed(4)),
    target: Number(target.toFixed(4)),
    loss: Number(loss.toFixed(5)),
    residualPctBefore: Number(residualBeforeAt1d.toFixed(1)),
    residualPctAfter: Number(residualAfterAt1d.toFixed(1)),
    optimalDayBefore,
    optimalDayAfter,
    deltaW1,
    deltaW2,
  };

  return {
    updatedWeights,
    updatedCard,
    logEntry,
  };
}

/**
 * Time-series forecasting + 0/1 Knapsack optimization for pre-exam study time budget.
 * Maximizes D-Day urgency-weighted retention gain within availableMinutes.
 */
export function optimizeExamReviewPlan(
  cards: StudyCard[],
  weights: MLPWeights,
  dDay: number,
  availableMinutes: number,
  now: Date = new Date()
): ExamOptimizationPlan {
  const safeDDay = Math.max(1, Math.min(30, Math.round(dDay)));
  const safeBudget = Math.max(5, Math.min(300, Math.round(availableMinutes)));

  if (cards.length === 0) {
    return {
      dDay: safeDDay,
      availableMinutes: safeBudget,
      usedMinutes: 0,
      selectedItems: [],
      deferredItems: [],
      baselineExamAvgPct: 100,
      optimizedExamAvgPct: 100,
      examAvgGainPct: 0,
      immediateAvgBeforePct: 100,
      immediateAvgAfterPct: 100,
      immediateGainPct: 0,
    };
  }

  const evaluations = cards.map((card) => {
    const cluster = inferCardCluster(card);
    const estimatedMinutes = getCardEstimatedMinutes(card);

    const currentPct = getCardRetentionAtDay(weights, card, card.elapsedDays).aiRetention * 100;
    const examSkipDay = Math.min(MAX_DAYS, card.elapsedDays + safeDDay);
    const examSkipPct = getCardRetentionAtDay(weights, card, examSkipDay).aiRetention * 100;

    // Simulate reviewing today: elapsedDays resets to 0, reviewCount + 1, outcome boosted toward remembered
    const reviewedCard: StudyCard = {
      ...card,
      elapsedDays: 0,
      reviewCount: card.reviewCount + 1,
      lastOutcome: 'remembered',
    };
    const examReviewDay = Math.min(MAX_DAYS, safeDDay);
    const examReviewPct =
      getCardRetentionAtDay(weights, reviewedCard, examReviewDay).aiRetention * 100;

    const gainPct = Math.max(0, Number((examReviewPct - examSkipPct).toFixed(1)));
    const optimalDropDay = findOptimalReviewDay(generateCurvePoints(weights, card, 70));
    const dropDeadline = formatReviewDeadline(optimalDropDay, card.elapsedDays, now);

    // D-Day urgency multiplier: higher when D-Day is close or card is already below 70%
    const overdueBonus = dropDeadline.isOverdue || currentPct < 70 ? 0.35 : 0;
    const urgencyWeight = 1 + 1.5 / safeDDay + overdueBonus;
    const weightedValue = gainPct * urgencyWeight;
    const efficiencyPerMin = Number((weightedValue / Math.max(1, estimatedMinutes)).toFixed(2));

    return {
      card,
      cluster,
      estimatedMinutes,
      currentRetentionPct: Number(currentPct.toFixed(1)),
      examSkipRetentionPct: Number(examSkipPct.toFixed(1)),
      examReviewRetentionPct: Number(examReviewPct.toFixed(1)),
      gainPct,
      efficiencyPerMin,
      optimalDropDay,
      dropDeadlineCompact: dropDeadline.compact,
      weightedValue,
    };
  });

  // Exact 0/1 Knapsack DP over minute budget
  const n = evaluations.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(safeBudget + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    const cost = evaluations[i - 1].estimatedMinutes;
    const val = evaluations[i - 1].weightedValue;
    for (let w = 0; w <= safeBudget; w++) {
      dp[i][w] = dp[i - 1][w];
      if (cost <= w) {
        const candidate = dp[i - 1][w - cost] + val;
        if (candidate > dp[i][w]) {
          dp[i][w] = candidate;
        }
      }
    }
  }

  const chosenSet = new Set<number>();
  let remW = safeBudget;
  for (let i = n; i >= 1; i--) {
    if (dp[i][remW] > dp[i - 1][remW] + 1e-6) {
      chosenSet.add(i - 1);
      remW -= evaluations[i - 1].estimatedMinutes;
    }
  }

  const allEvaluations: ExamItemEvaluation[] = evaluations.map(
    ({ weightedValue: _w, ...rest }, idx) => ({
      ...rest,
      selected: chosenSet.has(idx),
    })
  );

  const selectedItems = allEvaluations
    .filter((item) => item.selected)
    .sort((a, b) => b.efficiencyPerMin - a.efficiencyPerMin);
  const deferredItems = allEvaluations
    .filter((item) => !item.selected)
    .sort((a, b) => b.efficiencyPerMin - a.efficiencyPerMin);

  const usedMinutes = selectedItems.reduce((sum, item) => sum + item.estimatedMinutes, 0);

  const baselineExamAvgPct =
    allEvaluations.reduce((sum, item) => sum + item.examSkipRetentionPct, 0) / n;
  const optimizedExamAvgPct =
    allEvaluations.reduce(
      (sum, item) => sum + (item.selected ? item.examReviewRetentionPct : item.examSkipRetentionPct),
      0
    ) / n;

  const immediateAvgBeforePct =
    allEvaluations.reduce((sum, item) => sum + item.currentRetentionPct, 0) / n;
  const immediateAvgAfterPct =
    allEvaluations.reduce(
      (sum, item) => sum + (item.selected ? 100 : item.currentRetentionPct),
      0
    ) / n;

  return {
    dDay: safeDDay,
    availableMinutes: safeBudget,
    usedMinutes,
    selectedItems,
    deferredItems,
    baselineExamAvgPct: Number(baselineExamAvgPct.toFixed(1)),
    optimizedExamAvgPct: Number(optimizedExamAvgPct.toFixed(1)),
    examAvgGainPct: Number((optimizedExamAvgPct - baselineExamAvgPct).toFixed(1)),
    immediateAvgBeforePct: Number(immediateAvgBeforePct.toFixed(1)),
    immediateAvgAfterPct: Number(immediateAvgAfterPct.toFixed(1)),
    immediateGainPct: Number((immediateAvgAfterPct - immediateAvgBeforePct).toFixed(1)),
  };
}
