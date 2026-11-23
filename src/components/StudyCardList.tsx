import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileEdit, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { MLPWeights, StudyCard, WeaknessPointItem } from '../types';
import {
  CLUSTER_PROFILES,
  findOptimalReviewDay,
  formatDurationKorean,
  formatReviewDeadline,
  generateCurvePoints,
  getCardEstimatedMinutes,
  getCardRetentionAtDay,
  getDifficultyLabel,
  getOutcomeLabel,
  inferCardCluster,
} from '../lib/mlp';

interface StudyCardListProps {
  cards: StudyCard[];
  weights: MLPWeights;
  weakPoints: WeaknessPointItem[];
  selectedCardId: string;
  onSelectCard: (cardId: string) => void;
  onStartReview: (card: StudyCard) => void;
  onStartBlankPage: (card: StudyCard) => void;
  onStartWeaknessRetry: (card: StudyCard) => void;
  onDeleteCard: (cardId: string) => void;
  onOpenAddTab: () => void;
}

export const StudyCardList: React.FC<StudyCardListProps> = ({
  cards,
  weights,
  weakPoints,
  selectedCardId,
  onSelectCard,
  onStartReview,
  onStartBlankPage,
  onStartWeaknessRetry,
  onDeleteCard,
  onOpenAddTab,
}) => {
  const [pendingDeleteCard, setPendingDeleteCard] = useState<StudyCard | null>(null);

  useEffect(() => {
    if (!pendingDeleteCard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingDeleteCard(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingDeleteCard]);

  const handleConfirmDelete = () => {
    if (!pendingDeleteCard) return;
    onDeleteCard(pendingDeleteCard.id);
    setPendingDeleteCard(null);
  };

  return (
    <section aria-label="학습 과목 선택 및 복습 목록" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">
            학습 과목 선택 ({cards.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            항목을 선택하면 상단 망각곡선 그래프가 해당 과목으로 전환됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAddTab}
          className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>과목 추가</span>
        </button>
      </div>

      {cards.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <p className="text-sm font-medium text-slate-700">등록된 학습 항목이 없습니다.</p>
          <p className="text-xs text-slate-500 mt-1">과목 추가 탭에서 새 학습 카드를 등록해 주세요.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {cards.map((card) => {
            const isSelected = card.id === selectedCardId;
            const { aiRetention, residualDelta } = getCardRetentionAtDay(
              weights,
              card,
              card.elapsedDays
            );
            const curvePts = generateCurvePoints(weights, card, 70);
            const optDay = findOptimalReviewDay(curvePts);
            const deadline = formatReviewDeadline(optDay, card.elapsedDays);
            const pct = aiRetention * 100;
            const residualPct = residualDelta * 100;

            const isCritical = aiRetention <= 0.6;
            const isGolden = aiRetention > 0.6 && aiRetention <= 0.72;

            const statusColor = isCritical
              ? 'text-rose-700'
              : isGolden
                ? 'text-amber-700'
                : 'text-emerald-700';

            const barColor = isCritical
              ? 'bg-rose-600'
              : isGolden
                ? 'bg-amber-500'
                : 'bg-blue-600';

            const statusLabel = isCritical
              ? '긴급 복습'
              : isGolden
                ? '복습 권장'
                : '기억 안정';

            const StatusIcon = isCritical
              ? AlertTriangle
              : isGolden
                ? Clock
                : CheckCircle2;

            const clusterLabel = CLUSTER_PROFILES[inferCardCluster(card)].shortLabel;
            const estMinutes = getCardEstimatedMinutes(card);
            const cardUnresolvedWeakCount = weakPoints.filter(
              (wp) => wp.cardId === card.id && !wp.resolved
            ).length;

            return (
              <article
                key={card.id}
                onClick={() => onSelectCard(card.id)}
                className={`rounded-2xl p-4 border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/45 border-blue-600 ring-1 ring-blue-600/20'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Unboxed Metadata Line */}
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-500 min-w-0 truncate">
                    <span className="font-semibold text-slate-900 shrink-0">{card.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 text-blue-700 font-medium">{clusterLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">난이도 {getDifficultyLabel(card.difficulty)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 tabular-nums">{estMinutes}분</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 tabular-nums">복습 {card.reviewCount}회</span>
                  </div>

                  <div className={`inline-flex items-center gap-1 font-semibold shrink-0 ${statusColor}`}>
                    <StatusIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{statusLabel}</span>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-[15px] font-bold text-slate-900 mt-1.5 leading-snug">
                  {card.title}
                </h3>

                {/* Retention & Optimal Day Row */}
                <div className="mt-3">
                  <div className="flex items-baseline justify-between gap-2 text-xs mb-1.5 tabular-nums">
                    <span className="text-slate-600">
                      현재 AI 잔존율{' '}
                      <span className="font-mono-tabular font-bold text-slate-900 text-sm ml-0.5">
                        {pct.toFixed(1)}%
                      </span>
                      <span
                        className={`ml-1.5 font-mono-tabular text-[11px] font-semibold ${
                          residualPct >= 0.1
                            ? 'text-blue-700'
                            : residualPct <= -0.1
                              ? 'text-rose-600'
                              : 'text-slate-400'
                        }`}
                      >
                        ({residualPct >= 0 ? `+${residualPct.toFixed(1)}` : residualPct.toFixed(1)}%p 보정)
                      </span>
                    </span>
                    <span
                      className={`font-semibold ${
                        deadline.isOverdue ? 'text-rose-700' : 'text-blue-700'
                      }`}
                    >
                      {deadline.compact}
                    </span>
                  </div>

                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                      style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
                    />
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-500 truncate">
                    {card.lastOutcome
                      ? `최근: ${getOutcomeLabel(card.lastOutcome)}`
                      : `${formatDurationKorean(card.elapsedDays)} 경과`}
                    {cardUnresolvedWeakCount > 0 && (
                      <span className="ml-1.5 font-semibold text-rose-700">
                        · 남은 약점 {cardUnresolvedWeakCount}개
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteCard(card);
                      }}
                      title="학습 카드 삭제"
                      aria-label={`${card.title} 삭제`}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {cardUnresolvedWeakCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCard(card.id);
                          onStartWeaknessRetry(card);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>약점 재도전</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCard(card.id);
                        onStartBlankPage(card);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FileEdit className="w-3.5 h-3.5 text-blue-600" />
                      <span>백지 인출</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCard(card.id);
                        onStartReview(card);
                      }}
                      className={`px-3.5 py-2 min-h-[40px] text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      퀴즈 · 복습
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {pendingDeleteCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-card-dialog-title"
          aria-describedby="delete-card-dialog-desc"
          onClick={() => setPendingDeleteCard(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <h3
                    id="delete-card-dialog-title"
                    className="text-base font-bold text-slate-900 leading-snug"
                  >
                    학습 카드를 삭제할까요?
                  </h3>
                  <p className="text-xs font-semibold text-blue-700 mt-0.5">
                    {pendingDeleteCard.subject}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingDeleteCard(null)}
                aria-label="삭제 확인 창 닫기"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              id="delete-card-dialog-desc"
              className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1"
            >
              <p className="text-sm font-bold text-slate-900 leading-snug">
                {pendingDeleteCard.title}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                삭제한 학습 카드는 복구할 수 없으며, 복습 일정 목록에서도 제거됩니다.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingDeleteCard(null)}
                className="px-4 py-2.5 min-h-[42px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2.5 min-h-[42px] text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer"
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
