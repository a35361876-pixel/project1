import React, { useMemo, useState } from 'react';
import { Calendar, Clock, Play, Target, TrendingUp } from 'lucide-react';
import { MLPWeights, StudyCard } from '../types';
import { CLUSTER_PROFILES, optimizeExamReviewPlan } from '../lib/mlp';

interface ExamOptimizerPanelProps {
  cards: StudyCard[];
  weights: MLPWeights;
  selectedCardId: string;
  onSelectCard: (cardId: string) => void;
  onStartReview: (card: StudyCard) => void;
}

const MINUTE_PRESETS = [15, 30, 45, 60] as const;

export const ExamOptimizerPanel: React.FC<ExamOptimizerPanelProps> = ({
  cards,
  weights,
  selectedCardId,
  onSelectCard,
  onStartReview,
}) => {
  const [dDay, setDDay] = useState<number>(5);
  const [availableMinutes, setAvailableMinutes] = useState<number>(30);

  const plan = useMemo(
    () => optimizeExamReviewPlan(cards, weights, dDay, availableMinutes),
    [cards, weights, dDay, availableMinutes]
  );

  return (
    <section
      aria-label="시험 직전 제한 시간 복습 자원 배분 최적화"
      className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              시험 직전 제한 시간 자원 배분 최적화
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            남은 시험 일수(D-Day)와 가용 복습 시간(분)을 입력하면 시간 대비 기억 회복 효율이 가장 높은 최적 복습 조합(0/1 배낭 알고리즘)을 계산합니다.
          </p>
        </div>
      </div>

      {/* Controls: D-Day & Available Minutes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <label htmlFor="exam-dday-slider" className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>시험까지 남은 일수</span>
            </label>
            <span className="font-mono-tabular font-bold text-blue-700">D-{dDay}</span>
          </div>
          <input
            id="exam-dday-slider"
            type="range"
            min={1}
            max={21}
            step={1}
            value={dDay}
            onChange={(e) => setDDay(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] font-mono-tabular text-slate-400 mt-1">
            <span>D-1 (내일 시험)</span>
            <span>D-7</span>
            <span>D-14</span>
            <span>D-21</span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <label htmlFor="exam-minutes-slider" className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>오늘 복습 가능 시간</span>
            </label>
            <span className="font-mono-tabular font-bold text-slate-900">{availableMinutes}분</span>
          </div>
          <input
            id="exam-minutes-slider"
            type="range"
            min={10}
            max={90}
            step={5}
            value={availableMinutes}
            onChange={(e) => setAvailableMinutes(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {MINUTE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAvailableMinutes(preset)}
                className={`px-2.5 py-1 min-h-[30px] text-[11px] font-semibold font-mono-tabular rounded-lg border transition-colors cursor-pointer ${
                  availableMinutes === preset
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {preset}분
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Projected Gain KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 tabular-nums">
        <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80">
          <div className="text-[11px] font-semibold text-blue-700 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>D-{plan.dDay} 시험일 예상 평균 상승폭</span>
          </div>
          <div className="text-xl font-bold font-mono-tabular text-blue-800 mt-1">
            +{plan.examAvgGainPct.toFixed(1)}%p
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">
            미복습 {plan.baselineExamAvgPct}% → 최적 복습 {plan.optimizedExamAvgPct}%
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="text-[11px] font-medium text-slate-500">오늘 복습 직후 평균 잔존율</div>
          <div className="text-xl font-bold font-mono-tabular text-slate-900 mt-1">
            {plan.immediateAvgAfterPct.toFixed(1)}%
            <span className="text-xs font-semibold text-emerald-700 ml-1.5">
              (+{plan.immediateGainPct.toFixed(1)}%p)
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            현재 평균 {plan.immediateAvgBeforePct.toFixed(1)}% 기준
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="text-[11px] font-medium text-slate-500">시간 예산 배정 현황</div>
          <div className="text-xl font-bold font-mono-tabular text-slate-900 mt-1">
            {plan.usedMinutes}분{' '}
            <span className="text-sm font-medium text-slate-500">/ {plan.availableMinutes}분</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            총 {cards.length}개 중 {plan.selectedItems.length}개 과목 선택
          </div>
        </div>
      </div>

      {/* Selected & Deferred Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-900">
            <span>오늘 우선 복습 추천 목록 ({plan.selectedItems.length}개)</span>
            <span className="font-mono-tabular text-blue-700 font-semibold">
              총 {plan.usedMinutes}분 소요
            </span>
          </div>

          {plan.selectedItems.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
              입력한 가용 시간({availableMinutes}분) 안에 완료할 수 있는 항목이 없습니다. 시간을 늘려 보세요.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {plan.selectedItems.map((item, idx) => {
                const isSelected = item.card.id === selectedCardId;
                return (
                  <div
                    key={item.card.id}
                    onClick={() => onSelectCard(item.card.id)}
                    className={`p-3 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-50/50' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
                        <span className="font-bold text-blue-700 font-mono-tabular">
                          #{idx + 1}
                        </span>
                        <span className="font-semibold text-slate-800">{item.card.subject}</span>
                        <span aria-hidden="true">·</span>
                        <span>{CLUSTER_PROFILES[item.cluster].shortLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{item.estimatedMinutes}분</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular text-emerald-700 font-semibold">
                          효율 {item.efficiencyPerMin.toFixed(2)}%p/분
                        </span>
                      </div>
                      <div className="text-xs sm:text-sm font-semibold text-slate-900 truncate mt-0.5">
                        {item.card.title}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-tabular mt-0.5">
                        D-{plan.dDay} 예측: {item.examSkipRetentionPct}% →{' '}
                        <strong className="text-blue-700">{item.examReviewRetentionPct}%</strong>{' '}
                        (+{item.gainPct}%p) · 70% 기한 {item.dropDeadlineCompact}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCard(item.card.id);
                        onStartReview(item.card);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-2 min-h-[38px] text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      <span>복습</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
            <span>시간 초과 보류 항목 ({plan.deferredItems.length}개)</span>
            <span className="text-[11px] font-normal text-slate-400">다음 회차 이월</span>
          </div>

          {plan.deferredItems.length === 0 ? (
            <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-900">
              모든 학습 항목을 오늘 가용 시간 안에 복습할 수 있습니다.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {plan.deferredItems.map((item) => (
                <div
                  key={item.card.id}
                  onClick={() => onSelectCard(item.card.id)}
                  className="p-3 bg-slate-50/60 hover:bg-slate-100/70 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>
                      <strong className="text-slate-700">{item.card.subject}</strong> ·{' '}
                      {item.estimatedMinutes}분 필요
                    </span>
                    <span className="font-mono-tabular">
                      효율 {item.efficiencyPerMin.toFixed(2)}%p/분
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-700 truncate mt-0.5">
                    {item.card.title}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono-tabular mt-0.5">
                    기한 {item.dropDeadlineCompact} · 회복량 +{item.gainPct}%p
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
