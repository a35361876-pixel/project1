import React, { useMemo } from 'react';
import { Clock, RotateCcw } from 'lucide-react';
import { LearningCluster, MLPWeights, StudyCard, TrainingLogEntry } from '../types';
import {
  BASELINE_K,
  CLUSTER_PROFILES,
  LEARNING_RATE,
  calculateBaselineOptimalDays,
  computeClusterColdStartOffset,
  findOptimalReviewDay,
  formatReviewDeadline,
  forwardMLP,
  generateCurvePoints,
  getCardEstimatedMinutes,
  getCardRetentionAtDay,
  getDifficultyLabel,
  getOutcomeLabel,
  inferCardCluster,
  normalizeMLPInputs,
  optimizeExamReviewPlan,
} from '../lib/mlp';

interface MiniResidualReportProps {
  weights: MLPWeights;
  selectedCard: StudyCard;
  latestLog: TrainingLogEntry | null;
  onOpenAiTab: () => void;
}

/**
 * Compact Dashboard Summary Card showing Baseline vs MLP Residual ΔR and Cluster Cold-Start Prior
 */
export const MiniResidualReport: React.FC<MiniResidualReportProps> = ({
  weights,
  selectedCard,
  latestLog,
  onOpenAiTab,
}) => {
  const probeDay = 1.0;
  const { baseRetention, aiRetention, residualDelta } = getCardRetentionAtDay(
    weights,
    selectedCard,
    probeDay
  );
  const baseOpt = calculateBaselineOptimalDays();
  const aiOpt = findOptimalReviewDay(generateCurvePoints(weights, selectedCard, 70));
  const baseDeadline = formatReviewDeadline(baseOpt, selectedCard.elapsedDays);
  const aiDeadline = formatReviewDeadline(aiOpt, selectedCard.elapsedDays);
  const residualPct = residualDelta * 100;
  const cluster = CLUSTER_PROFILES[inferCardCluster(selectedCard)];
  const clusterOffset = computeClusterColdStartOffset(selectedCard);

  return (
    <section
      aria-label="신경망 보정 원리 요약 리포트"
      className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            신경망 보정 원리 미니 리포트 (Explainable AI)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {selectedCard.subject} · {cluster.shortLabel} 기준 1일 경과 시점 잔차 보정량
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAiTab}
          className="text-xs font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          상세 검증 리포트 →
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2.5 text-xs tabular-nums">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
          <div className="text-[11px] text-slate-500">1단계 기준 예측</div>
          <div className="text-base font-bold font-mono-tabular text-slate-800 mt-0.5">
            {(baseRetention * 100).toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">{baseDeadline.compact}</div>
        </div>

        <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/80">
          <div className="text-[11px] text-blue-700 font-medium">2단계 AI 보정</div>
          <div className="text-base font-bold font-mono-tabular text-blue-800 mt-0.5">
            {(aiRetention * 100).toFixed(1)}%
          </div>
          <div className="text-[11px] text-blue-600 font-semibold mt-0.5">{aiDeadline.compact}</div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
          <div className="text-[11px] text-slate-500">오차 보정량 (ΔR)</div>
          <div
            className={`text-base font-bold font-mono-tabular mt-0.5 ${
              residualPct >= 0.1
                ? 'text-blue-700'
                : residualPct <= -0.1
                  ? 'text-rose-600'
                  : 'text-slate-700'
            }`}
          >
            {residualPct >= 0 ? `+${residualPct.toFixed(1)}%p` : `${residualPct.toFixed(1)}%p`}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            군집 초기 계수 {clusterOffset >= 0 ? `+${(clusterOffset * 100).toFixed(0)}%` : `${(clusterOffset * 100).toFixed(0)}%`}
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tabular text-slate-500">
        <span>
          은닉층 출력 가중치 W⁽²⁾: [{weights.w2.map((w) => w.toFixed(2)).join(', ')}]
        </span>
        <span>
          {latestLog
            ? `직전 ΔW₂ 최대: ${Math.max(...latestLog.deltaW2.map(Math.abs)).toFixed(4)}`
            : '학습 대기 중'}
        </span>
      </div>
    </section>
  );
};

interface AIPrinciplePanelProps {
  cards: StudyCard[];
  weights: MLPWeights;
  selectedCard: StudyCard;
  logs: TrainingLogEntry[];
  onSimulateTimePass: (hours: number) => void;
  onResetDemo: () => void;
}

const CLUSTER_KEYS: LearningCluster[] = ['vocab', 'concept', 'formula'];

export const AIPrinciplePanel: React.FC<AIPrinciplePanelProps> = ({
  cards,
  weights,
  selectedCard,
  logs,
  onSimulateTimePass,
  onResetDemo,
}) => {
  const latestLog = logs[0] || null;
  const activeInputs = normalizeMLPInputs(
    Math.max(0.5, selectedCard.elapsedDays),
    selectedCard.difficulty,
    selectedCard.lastOutcome,
    selectedCard.reviewCount
  );
  const currentForward = forwardMLP(weights, activeInputs);
  const sampleAt1d = getCardRetentionAtDay(weights, selectedCard, 1.0);
  const aiOptDay = findOptimalReviewDay(generateCurvePoints(weights, selectedCard, 70));
  const aiDeadline = formatReviewDeadline(aiOptDay, selectedCard.elapsedDays);

  const selectedClusterId = inferCardCluster(selectedCard);
  const selectedClusterProfile = CLUSTER_PROFILES[selectedClusterId];
  const selectedClusterOffset = computeClusterColdStartOffset(selectedCard);
  const selectedEstMinutes = getCardEstimatedMinutes(selectedCard);

  const sampleOptimization = useMemo(
    () => optimizeExamReviewPlan(cards, weights, 5, 30),
    [cards, weights]
  );
  const allEvaluations = useMemo(
    () =>
      [...sampleOptimization.selectedItems, ...sampleOptimization.deferredItems].sort(
        (a, b) => b.efficiencyPerMin - a.efficiencyPerMin
      ),
    [sampleOptimization]
  );

  // SVG Layout for 4-4-1 Residual MLP
  const svgW = 540;
  const svgH = 264;
  const inputX = 76;
  const hiddenX = 272;
  const outputX = 462;
  const inputYs = [42, 98, 154, 210];
  const hiddenYs = [42, 98, 154, 210];
  const outputY = 126;

  const inputLabels = [
    { name: 'x₁ 경과시간', val: activeInputs[0].toFixed(2) },
    { name: 'x₂ 난이도', val: activeInputs[1].toFixed(2) },
    { name: 'x₃ 테스트결과', val: activeInputs[2].toFixed(2) },
    { name: 'x₄ 누적복습', val: activeInputs[3].toFixed(2) },
  ];

  return (
    <section aria-label="AI 모델 투명성 및 검증 리포트" className="space-y-4">
      {/* 1. Hybrid Residual Formula & Simulation Controls */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              Explainable AI — 모델 투명성 및 검증 리포트
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              이론적 에빙하우스 기준선, 군집 초기 보정, 4-4-1 잔차 신경망, Gemini NLP 판별 근거 및 자원 배분 효율 수식을 투명하게 검증합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSimulateTimePass(12)}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>+12시간 경과</span>
            </button>
            <button
              type="button"
              onClick={() => onSimulateTimePass(24)}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>+1일 경과</span>
            </button>
            <button
              type="button"
              onClick={onResetDemo}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>초기화</span>
            </button>
          </div>
        </div>

        {/* 2-Stage Formula Comparison */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="text-[11px] font-semibold text-slate-500 mb-1">
              1단계: 표준 에빙하우스 기준선 (Cold Start 방지)
            </div>
            <div className="font-mono-tabular text-sm sm:text-base font-semibold text-slate-900">
              R<sub>base</sub>(t) = e<sup>-t / {BASELINE_K}</sup>
            </div>
            <div className="text-xs text-slate-500 mt-1 tabular-nums">
              t=1일 기준 예측: {(sampleAt1d.baseRetention * 100).toFixed(1)}% (고정 점선)
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200/80">
            <div className="text-[11px] font-semibold text-blue-700 mb-1">
              2단계: 군집 가중치 + 신경망 잔차 보정 곡선
            </div>
            <div className="font-mono-tabular text-sm sm:text-base font-semibold text-slate-900">
              R<sub>AI</sub>(t) = R<sub>base</sub>(t) + ΔR(MLP + Cluster)
            </div>
            <div className="text-xs text-blue-800 mt-1 tabular-nums">
              현재 보정 후: {(sampleAt1d.aiRetention * 100).toFixed(1)}% · 권장: {aiDeadline.compact}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Gemini NLP Assessment & Clustering Transparency */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            군집화(Clustering) 초기 보정 및 Gemini NLP 난이도 판별 근거
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            선택 과목: {selectedCard.subject} — {selectedCard.title}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <div className="font-bold text-slate-800">
              배정 군집: {selectedClusterProfile.label}
            </div>
            <p className="text-slate-600 leading-relaxed">
              {selectedCard.clusterReason || selectedClusterProfile.description}
            </p>
            <div className="text-[11px] font-mono-tabular text-blue-700 font-semibold pt-1">
              현재 군집 보정 신호: {selectedClusterOffset >= 0 ? `+${selectedClusterOffset.toFixed(3)}` : selectedClusterOffset.toFixed(3)} · 예상 복습 {selectedEstMinutes}분
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <div className="font-bold text-slate-800">
              Gemini NLP 난이도 판별: {getDifficultyLabel(selectedCard.difficulty)} (수준 {selectedCard.difficulty}/3)
            </div>
            <p className="text-slate-600 leading-relaxed">
              {selectedCard.aiDifficultyReason ||
                '개념의 추상성과 오답 유발 요인을 바탕으로 초기 난이도를 설정했습니다.'}
            </p>
            <div className="text-[11px] text-slate-500 pt-1">
              맞춤형 빈칸 퀴즈:{' '}
              <strong className="text-slate-800">
                {selectedCard.clozeQuiz ? '생성 및 연동 완료' : '미생성 (복습 시 즉시 생성 가능)'}
              </strong>
            </div>
          </div>
        </div>

        {/* 3-Cluster Calibration Matrix */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-slate-400 border-b border-slate-200">
                <th className="py-2 text-left font-medium">학습 군집</th>
                <th className="py-2 text-right font-medium">초기 잔차 계수</th>
                <th className="py-2 text-right font-medium">반복 정착 가산</th>
                <th className="py-2 text-right font-medium">기본 소요시간</th>
                <th className="py-2 text-left pl-4 font-medium">망각 특성</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {CLUSTER_KEYS.map((key) => {
                const p = CLUSTER_PROFILES[key];
                const isActive = key === selectedClusterId;
                return (
                  <tr key={key} className={isActive ? 'bg-blue-50/50 font-semibold' : ''}>
                    <td className="py-2 text-slate-900">
                      {p.shortLabel}
                      {isActive && <span className="ml-1.5 text-[10px] text-blue-700">(적용 중)</span>}
                    </td>
                    <td className="py-2 text-right font-mono-tabular">
                      {p.coldStartPrior >= 0 ? `+${p.coldStartPrior.toFixed(2)}` : p.coldStartPrior.toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono-tabular text-blue-700">
                      +{p.repetitionGain.toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono-tabular">{p.defaultMinutes}분</td>
                    <td className="py-2 pl-4 text-slate-600 font-normal">{p.decaySignature}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Scheduling Efficiency Formula & Per-Card Verification Table */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            시험 직전 자원 배분 최적화 수식 및 과목별 효율 검증 (D-5 · 30분 기준)
          </h3>
          <p className="text-xs font-mono-tabular text-slate-600 mt-1 bg-slate-50 border border-slate-200/70 rounded-xl px-3 py-2">
            효율 점수 E<sub>i</sub> = [ (R<sub>복습 후 시험일</sub> - R<sub>미복습 시험일</sub>) × w<sub>D-Day</sub> ] ÷ 소요시간<sub>i</sub> (분)
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse tabular-nums">
            <thead>
              <tr className="text-slate-400 border-b border-slate-200">
                <th className="py-2 text-left font-medium">과목 · 개념</th>
                <th className="py-2 text-right font-medium">소요시간</th>
                <th className="py-2 text-right font-medium">미복습 → 복습(D-5)</th>
                <th className="py-2 text-right font-medium">기억 회복량</th>
                <th className="py-2 text-right font-medium">효율 비율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {allEvaluations.map((item) => (
                <tr key={item.card.id}>
                  <td className="py-2 pr-3 max-w-[220px] truncate">
                    <span className="font-semibold text-slate-900 mr-1">{item.card.subject}</span>
                    <span className="text-slate-600">{item.card.title}</span>
                  </td>
                  <td className="py-2 text-right font-mono-tabular">{item.estimatedMinutes}분</td>
                  <td className="py-2 text-right font-mono-tabular text-slate-600">
                    {item.examSkipRetentionPct}% → {item.examReviewRetentionPct}%
                  </td>
                  <td className="py-2 text-right font-mono-tabular font-semibold text-blue-700">
                    +{item.gainPct.toFixed(1)}%p
                  </td>
                  <td className="py-2 text-right font-mono-tabular font-bold text-emerald-700">
                    {item.efficiencyPerMin.toFixed(2)}%p/분
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. 4-4-1 Residual MLP Architecture SVG */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              인공신경망 구조 (Input 4 → Hidden 4 ReLU → Residual ΔR)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              현재 기준 과목: {selectedCard.subject} ({selectedCard.title})
            </p>
          </div>
          <div className="text-[11px] font-mono-tabular text-slate-500">
            학습률 η = {LEARNING_RATE}
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="w-full min-w-[340px] h-auto select-none"
            role="img"
            aria-label="4-4-1 잔차 학습 인공신경망 다이어그램"
          >
            <text x={inputX} y={16} textAnchor="middle" className="text-[11px] font-semibold" fill="#475569">
              입력층 (4)
            </text>
            <text x={hiddenX} y={16} textAnchor="middle" className="text-[11px] font-semibold" fill="#475569">
              은닉층 (4 · ReLU)
            </text>
            <text x={outputX} y={16} textAnchor="middle" className="text-[11px] font-semibold" fill="#475569">
              보정 출력 (tanh)
            </text>

            {/* Connections W1 (4x4) */}
            {inputYs.map((iy, i) =>
              hiddenYs.map((hy, j) => {
                const w = weights.w1[i][j];
                const strokeColor = w >= 0 ? '#2563EB' : '#E11D48';
                const strokeWidth = Math.max(0.75, Math.min(3.8, Math.abs(w) * 4.5));
                return (
                  <line
                    key={`w1-${i}-${j}`}
                    x1={inputX + 16}
                    y1={iy}
                    x2={hiddenX - 16}
                    y2={hy}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeOpacity={0.45}
                  />
                );
              })
            )}

            {/* Connections W2 (4x1) */}
            {hiddenYs.map((hy, j) => {
              const w = weights.w2[j];
              const strokeColor = w >= 0 ? '#2563EB' : '#E11D48';
              const strokeWidth = Math.max(0.9, Math.min(4.5, Math.abs(w) * 4.5));
              return (
                <line
                  key={`w2-${j}`}
                  x1={hiddenX + 16}
                  y1={hy}
                  x2={outputX - 20}
                  y2={outputY}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeOpacity={0.68}
                />
              );
            })}

            {/* Input Nodes (4) */}
            {inputYs.map((iy, i) => (
              <g key={`in-${i}`}>
                <circle cx={inputX} cy={iy} r={16} fill="#F8FAFC" stroke="#334155" strokeWidth={1.6} />
                <text
                  x={inputX}
                  y={iy + 4}
                  textAnchor="middle"
                  className="text-[10px] font-mono-tabular font-semibold"
                  fill="#0F172A"
                >
                  {inputLabels[i].val}
                </text>
                <text
                  x={inputX}
                  y={iy + 27}
                  textAnchor="middle"
                  className="text-[10px]"
                  fill="#64748B"
                >
                  {inputLabels[i].name}
                </text>
              </g>
            ))}

            {/* Hidden Nodes (4 ReLU) */}
            {hiddenYs.map((hy, j) => {
              const act = currentForward.hidden[j];
              const isActive = act > 0;
              return (
                <g key={`hid-${j}`}>
                  <circle
                    cx={hiddenX}
                    cy={hy}
                    r={16}
                    fill={isActive ? '#EFF6FF' : '#F1F5F9'}
                    stroke={isActive ? '#2563EB' : '#94A3B8'}
                    strokeWidth={1.6}
                  />
                  <text
                    x={hiddenX}
                    y={hy + 4}
                    textAnchor="middle"
                    className="text-[10px] font-mono-tabular font-semibold"
                    fill={isActive ? '#1E40AF' : '#64748B'}
                  >
                    {act.toFixed(2)}
                  </text>
                  <text
                    x={hiddenX + 24}
                    y={hy + 4}
                    textAnchor="start"
                    className="text-[10px] font-mono-tabular"
                    fill="#64748B"
                  >
                    h{j + 1}
                  </text>
                </g>
              );
            })}

            {/* Output Node (Residual ΔR) */}
            <g>
              <circle
                cx={outputX}
                cy={outputY}
                r={22}
                fill={currentForward.output >= 0 ? '#2563EB' : '#DC2626'}
                stroke="#0F172A"
                strokeWidth={1.5}
              />
              <text
                x={outputX}
                y={outputY + 4}
                textAnchor="middle"
                className="text-[11px] font-mono-tabular font-semibold"
                fill="#FFFFFF"
              >
                {currentForward.output >= 0
                  ? `+${currentForward.output.toFixed(2)}`
                  : currentForward.output.toFixed(2)}
              </text>
              <text
                x={outputX}
                y={outputY + 38}
                textAnchor="middle"
                className="text-[11px] font-semibold"
                fill="#0F172A"
              >
                잔차 보정 ΔR
              </text>
            </g>
          </svg>
        </div>

        {/* Hidden & Output Weight Table */}
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">
              입력 → 은닉층 가중치 행렬 W⁽¹⁾ (4×4)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono-tabular border-collapse">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-200">
                    <th className="py-1.5 text-left font-medium">입력</th>
                    <th className="py-1.5 text-right font-medium">h₁</th>
                    <th className="py-1.5 text-right font-medium">h₂</th>
                    <th className="py-1.5 text-right font-medium">h₃</th>
                    <th className="py-1.5 text-right font-medium">h₄</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {['x₁ 시간', 'x₂ 난이도', 'x₃ 결과', 'x₄ 복습수'].map((label, i) => (
                    <tr key={label}>
                      <td className="py-1.5 font-sans text-slate-600 font-medium">{label}</td>
                      {weights.w1[i].map((w, j) => (
                        <td key={j} className="py-1.5 text-right">
                          {w >= 0 ? `+${w.toFixed(2)}` : w.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">
              은닉 → 잔차 출력 가중치 W⁽²⁾ 및 직전 ΔW⁽²⁾
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono-tabular border-collapse">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-200">
                    <th className="py-1.5 text-left font-medium">연결</th>
                    <th className="py-1.5 text-right font-medium">현재 가중치</th>
                    <th className="py-1.5 text-right font-medium">직전 ΔW⁽²⁾</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {weights.w2.map((w, j) => {
                    const delta = latestLog ? latestLog.deltaW2[j] : 0;
                    return (
                      <tr key={j}>
                        <td className="py-1.5 text-slate-600">h{j + 1} → ΔR</td>
                        <td className="py-1.5 text-right">
                          {w >= 0 ? `+${w.toFixed(4)}` : w.toFixed(4)}
                        </td>
                        <td
                          className={`py-1.5 text-right ${
                            delta > 0
                              ? 'text-blue-700 font-semibold'
                              : delta < 0
                                ? 'text-rose-600 font-semibold'
                                : 'text-slate-400'
                          }`}
                        >
                          {delta > 0 ? `+${delta.toFixed(4)}` : delta.toFixed(4)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Training History Log */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-3">
          신경망 역전파 학습 기록 ({logs.length}건)
        </h3>

        {logs.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-50 border border-slate-200/70 text-center">
            <p className="text-xs sm:text-sm font-medium text-slate-700">
              아직 복습 결과 기반 가중치 업데이트 기록이 없습니다.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              대시보드에서 [퀴즈 풀기 · 복습]을 진행하면 4-4-1 신경망이 즉시 학습됩니다.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {logs.slice(0, 8).map((entry) => (
              <div key={entry.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-500 min-w-0 truncate">
                    <span className="font-mono-tabular text-slate-400">{entry.timestamp}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-slate-800">{entry.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{entry.cardTitle}</span>
                  </div>
                  <span
                    className={`font-mono-tabular font-semibold shrink-0 ${
                      entry.residualPctAfter >= 0 ? 'text-blue-700' : 'text-rose-700'
                    }`}
                  >
                    ΔR: {entry.residualPctBefore >= 0 ? `+${entry.residualPctBefore}` : entry.residualPctBefore}%p →{' '}
                    {entry.residualPctAfter >= 0 ? `+${entry.residualPctAfter}` : entry.residualPctAfter}%p
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-tabular text-slate-500">
                  <span>결과: {getOutcomeLabel(entry.outcome)}</span>
                  <span>최적 복습일: {entry.optimalDayBefore.toFixed(1)}일 → {entry.optimalDayAfter.toFixed(1)}일</span>
                  <span>Loss={entry.loss.toFixed(4)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
