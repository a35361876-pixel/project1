import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CurvePoint, MLPWeights, StudyCard } from '../types';
import {
  BASELINE_K,
  CLUSTER_PROFILES,
  MAX_DAYS,
  RETENTION_THRESHOLD,
  calculateBaselineOptimalDays,
  findOptimalReviewDay,
  formatReviewDeadline,
  generateCurvePoints,
  getCardEstimatedMinutes,
  inferCardCluster,
} from '../lib/mlp';

interface ForgettingCurveChartProps {
  weights: MLPWeights;
  selectedCard: StudyCard;
  onOpenReview: (card: StudyCard) => void;
  onOpenBlankPage: (card: StudyCard) => void;
}

export const ForgettingCurveChart: React.FC<ForgettingCurveChartProps> = ({
  weights,
  selectedCard,
  onOpenReview,
  onOpenBlankPage,
}) => {
  const [inspectDay, setInspectDay] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const targetPoints = useMemo<CurvePoint[]>(
    () => generateCurvePoints(weights, selectedCard, 70),
    [weights, selectedCard]
  );

  // Smoothly animate AI curve Y values whenever weights or selectedCard changes
  const [animatedAiValues, setAnimatedAiValues] = useState<number[]>(() =>
    targetPoints.map((p) => p.aiRetention)
  );
  const currentValuesRef = useRef<number[]>(targetPoints.map((p) => p.aiRetention));

  useEffect(() => {
    const startValues = [...currentValuesRef.current];
    const endValues = targetPoints.map((p) => p.aiRetention);
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || startValues.length !== endValues.length) {
      currentValuesRef.current = endValues;
      setAnimatedAiValues(endValues);
      return;
    }

    let rafId = 0;
    const duration = 520;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // Smooth ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = endValues.map(
        (endVal, idx) => startValues[idx] + (endVal - startValues[idx]) * eased
      );
      currentValuesRef.current = next;
      setAnimatedAiValues(next);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [targetPoints]);

  // SVG coordinate system
  const width = 640;
  const height = 310;
  const pad = { top: 24, right: 20, bottom: 42, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xScale = (day: number) => pad.left + (Math.min(MAX_DAYS, Math.max(0, day)) / MAX_DAYS) * plotW;
  const yScale = (retention: number) =>
    pad.top + (1 - Math.max(0, Math.min(1, retention))) * plotH;

  const { basePath, aiPath, residualBandPath, baseOptDay, aiOptDay } = useMemo(() => {
    const basePts: string[] = [];
    const aiPts: string[] = [];
    const aiReversePts: string[] = [];

    for (let i = 0; i < targetPoints.length; i++) {
      const pt = targetPoints[i];
      const aiR = animatedAiValues[i] ?? pt.aiRetention;
      const x = xScale(pt.day).toFixed(1);
      const yBase = yScale(pt.baseRetention).toFixed(1);
      const yAi = yScale(aiR).toFixed(1);

      basePts.push(`${i === 0 ? 'M' : 'L'} ${x} ${yBase}`);
      aiPts.push(`${i === 0 ? 'M' : 'L'} ${x} ${yAi}`);
      aiReversePts.unshift(`L ${x} ${yAi}`);
    }

    return {
      basePath: basePts.join(' '),
      aiPath: aiPts.join(' '),
      residualBandPath: `${basePts.join(' ')} ${aiReversePts.join(' ')} Z`,
      baseOptDay: calculateBaselineOptimalDays(),
      aiOptDay: findOptimalReviewDay(targetPoints),
    };
  }, [targetPoints, animatedAiValues]);

  const thresholdY = yScale(RETENTION_THRESHOLD);
  const yTicks = [1.0, 0.7, 0.5, 0.25, 0];
  const xTicks = [0, 2, 4, 6, 8, 10, 12, 14];

  const handlePointer = (clientX: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * width;
    const clamped = Math.max(pad.left, Math.min(width - pad.right, relX));
    const day = ((clamped - pad.left) / plotW) * MAX_DAYS;
    setInspectDay(Number(day.toFixed(1)));
  };

  const activeDay = inspectDay !== null ? inspectDay : Math.min(MAX_DAYS, Math.max(0.5, aiOptDay));
  const activeIdx = Math.min(
    targetPoints.length - 1,
    Math.round((activeDay / MAX_DAYS) * (targetPoints.length - 1))
  );
  const activePoint = targetPoints[activeIdx];
  const activeBasePct = (activePoint?.baseRetention ?? 0.7) * 100;
  const activeAiPct = (animatedAiValues[activeIdx] ?? activePoint?.aiRetention ?? 0.7) * 100;
  const residualPct = activeAiPct - activeBasePct;

  const cardCurrentIdx = Math.min(
    targetPoints.length - 1,
    Math.round((Math.min(MAX_DAYS, selectedCard.elapsedDays) / MAX_DAYS) * (targetPoints.length - 1))
  );
  const cardCurrentRetention =
    animatedAiValues[cardCurrentIdx] ?? targetPoints[cardCurrentIdx]?.aiRetention ?? 1;

  const deadline = formatReviewDeadline(aiOptDay, selectedCard.elapsedDays);
  const clusterProfile = CLUSTER_PROFILES[inferCardCluster(selectedCard)];
  const estMinutes = getCardEstimatedMinutes(selectedCard);

  return (
    <section
      aria-label="2단계 망각곡선 실시간 보정 그래프"
      className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5"
    >
      {/* Selected Subject Header + Optimal Review Day Recommendation */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-semibold text-blue-700">{selectedCard.subject}</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-slate-700">{clusterProfile.shortLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">예상 {estMinutes}분</span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate mt-0.5">
            {selectedCard.title}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onOpenBlankPage(selectedCard)}
            className="px-3 py-2 min-h-[40px] text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            백지 인출하기
          </button>
          <button
            type="button"
            onClick={() => onOpenReview(selectedCard)}
            className="px-3.5 py-2 min-h-[40px] text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            퀴즈 풀기 · 복습
          </button>
        </div>
      </div>

      {/* Real-Time Review Deadline Callout */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 mb-2.5 rounded-xl border text-xs ${
          deadline.isOverdue
            ? 'bg-rose-50/80 border-rose-200 text-rose-900'
            : 'bg-blue-50/70 border-blue-200 text-slate-900'
        }`}
      >
        <div>
          <span className="text-[11px] font-medium text-slate-500 block">
            AI 추천 복습 골든타임 (기억 70% 도달 전)
          </span>
          <span
            className={`text-sm sm:text-base font-bold ${
              deadline.isOverdue ? 'text-rose-700' : 'text-blue-700'
            }`}
          >
            {deadline.isOverdue ? deadline.headline : `${deadline.headline} 복습하세요`}
          </span>
        </div>
        <span className="text-[11px] font-medium text-slate-600 tabular-nums">
          {deadline.sublabel}
        </span>
      </div>

      {/* Baseline vs AI Residual Callout Strip */}
      <div className="grid grid-cols-2 gap-2 p-3 mb-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs tabular-nums">
        <div>
          <div className="text-[11px] text-slate-500">에빙하우스 기준 ({activeDay.toFixed(1)}일)</div>
          <div className="font-mono-tabular font-semibold text-slate-700 mt-0.5">
            {(activeBasePct).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">AI 보정 예측 ({activeDay.toFixed(1)}일)</div>
          <div className="font-mono-tabular font-bold text-blue-700 mt-0.5">
            {activeAiPct.toFixed(1)}%{' '}
            <span
              className={`text-[11px] font-semibold ${
                residualPct >= 0.1
                  ? 'text-blue-600'
                  : residualPct <= -0.1
                    ? 'text-rose-600'
                    : 'text-slate-500'
              }`}
            >
              ({residualPct >= 0 ? `+${residualPct.toFixed(1)}` : residualPct.toFixed(1)}%p)
            </span>
          </div>
        </div>
      </div>

      {/* Interactive SVG 0~14 Day Dual-Curve Chart */}
      <div className="relative w-full overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto touch-none select-none cursor-crosshair"
          onPointerMove={(e) => handlePointer(e.clientX)}
          onPointerDown={(e) => handlePointer(e.clientX)}
          onPointerLeave={() => setInspectDay(null)}
        >
          {/* Shaded area below 70% threshold */}
          <rect
            x={pad.left}
            y={thresholdY}
            width={plotW}
            height={yScale(0) - thresholdY}
            fill="#FEF2F2"
            fillOpacity="0.45"
          />

          {/* Horizontal Grid Lines & Red 70% Golden Time Line */}
          {yTicks.map((tick) => {
            const y = yScale(tick);
            const isThreshold = tick === RETENTION_THRESHOLD;
            return (
              <g key={tick}>
                <line
                  x1={pad.left}
                  y1={y}
                  x2={width - pad.right}
                  y2={y}
                  stroke={isThreshold ? '#DC2626' : '#E2E8F0'}
                  strokeWidth={isThreshold ? 1.75 : 1}
                  strokeDasharray={isThreshold ? '5 4' : undefined}
                />
                <text
                  x={pad.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="text-[11px] font-mono-tabular"
                  fill={isThreshold ? '#DC2626' : '#64748B'}
                  fontWeight={isThreshold ? 700 : 400}
                >
                  {Math.round(tick * 100)}%
                </text>
              </g>
            );
          })}

          {/* Vertical Grid Lines & 0..14 Day Ticks */}
          {xTicks.map((tick) => {
            const x = xScale(tick);
            return (
              <g key={tick}>
                <line x1={x} y1={pad.top} x2={x} y2={yScale(0)} stroke="#F1F5F9" strokeWidth={1} />
                <text
                  x={x}
                  y={height - 14}
                  textAnchor="middle"
                  className="text-[11px] font-mono-tabular"
                  fill="#64748B"
                >
                  {tick}일
                </text>
              </g>
            );
          })}

          {/* Red 70% Golden Time Threshold Label */}
          <text
            x={width - pad.right - 4}
            y={thresholdY - 6}
            textAnchor="end"
            className="text-[11px]"
            fill="#DC2626"
            fontWeight={600}
          >
            복습 골든타임 기준선 (70%)
          </text>

          {/* Neural Residual Band between Baseline and AI Curve */}
          <path d={residualBandPath} fill="#2563EB" fillOpacity="0.11" />

          {/* Stage 1: Standard Ebbinghaus Baseline (Gray Dashed Line) */}
          <path
            d={basePath}
            fill="none"
            stroke="#94A3B8"
            strokeWidth={2.25}
            strokeDasharray="6 5"
          />

          {/* Stage 2: AI MLP Corrected Curve (Blue Solid Line) */}
          <path
            d={aiPath}
            fill="none"
            stroke="#2563EB"
            strokeWidth={3.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* 70% Intersection Marker (Optimal Review Day) */}
          <g>
            <line
              x1={xScale(aiOptDay)}
              y1={thresholdY}
              x2={xScale(aiOptDay)}
              y2={yScale(0)}
              stroke="#DC2626"
              strokeWidth={1.25}
              strokeDasharray="3 3"
              opacity={0.75}
            />
            <circle
              cx={xScale(aiOptDay)}
              cy={thresholdY}
              r={5.5}
              fill="#FFFFFF"
              stroke="#DC2626"
              strokeWidth={2.5}
            />
            <circle cx={xScale(baseOptDay)} cy={thresholdY} r={3.5} fill="#94A3B8" />
            <text
              x={Math.min(width - pad.right - 4, Math.max(pad.left + 44, xScale(aiOptDay) + 8))}
              y={thresholdY + 15}
              textAnchor="start"
              className="text-[10px] font-semibold"
              fill="#DC2626"
            >
              {deadline.compact}
            </text>
          </g>

          {/* Current Elapsed Day Position of Selected Card */}
          {selectedCard.elapsedDays <= MAX_DAYS && (
            <circle
              cx={xScale(selectedCard.elapsedDays)}
              cy={yScale(cardCurrentRetention)}
              r={5.5}
              fill="#1D4ED8"
              stroke="#FFFFFF"
              strokeWidth={2}
            />
          )}

          {/* Pointer Inspection Crosshair */}
          {inspectDay !== null && (
            <g>
              <line
                x1={xScale(activeDay)}
                y1={pad.top}
                x2={xScale(activeDay)}
                y2={yScale(0)}
                stroke="#0F172A"
                strokeWidth={1}
                strokeOpacity={0.3}
              />
              <circle cx={xScale(activeDay)} cy={yScale(activeBasePct / 100)} r={4} fill="#64748B" />
              <circle
                cx={xScale(activeDay)}
                cy={yScale(activeAiPct / 100)}
                r={5}
                fill="#2563EB"
                stroke="#FFFFFF"
                strokeWidth={1.5}
              />
            </g>
          )}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-1 border-t border-slate-100 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 border-t-2 border-dashed border-slate-400" />
            <span>표준 에빙하우스 (k={BASELINE_K})</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 border-t-[3px] border-blue-600 rounded-full" />
            <span className="font-semibold text-slate-900">AI 신경망 보정 곡선</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 border-t-2 border-dashed border-red-600" />
            <span className="text-red-700 font-medium">70% 기준선</span>
          </div>
        </div>
        <span className="text-[11px] text-slate-400">
          터치·드래그로 일자별 보정값(ΔR) 확인
        </span>
      </div>
    </section>
  );
};
