import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { StudyCard, WeaknessPointItem } from '../types';

interface WeaknessBankPanelProps {
  cards: StudyCard[];
  weakPoints: WeaknessPointItem[];
  onStartWeaknessRetry: (card: StudyCard) => void;
  onStartBlankPage: (card: StudyCard) => void;
  onDeleteWeakPoint: (weakPointId: string) => void;
}

export const WeaknessBankPanel: React.FC<WeaknessBankPanelProps> = ({
  cards,
  weakPoints,
  onStartWeaknessRetry,
  onStartBlankPage,
  onDeleteWeakPoint,
}) => {
  const [filter, setFilter] = useState<'unresolved' | 'resolved'>('unresolved');

  const cardMap = useMemo(() => {
    const map = new Map<string, StudyCard>();
    for (const c of cards) map.set(c.id, c);
    return map;
  }, [cards]);

  const unresolvedItems = useMemo(
    () => weakPoints.filter((wp) => !wp.resolved),
    [weakPoints]
  );
  const resolvedItems = useMemo(
    () => weakPoints.filter((wp) => wp.resolved),
    [weakPoints]
  );

  const visibleItems = filter === 'unresolved' ? unresolvedItems : resolvedItems;

  const groupedByCard = useMemo(() => {
    const groups = new Map<
      string,
      {
        cardId: string;
        cardTitle: string;
        subject: string;
        card?: StudyCard;
        items: WeaknessPointItem[];
      }
    >();

    for (const wp of visibleItems) {
      const existing = groups.get(wp.cardId);
      const liveCard = cardMap.get(wp.cardId);
      if (existing) {
        existing.items.push(wp);
      } else {
        groups.set(wp.cardId, {
          cardId: wp.cardId,
          cardTitle: liveCard?.title ?? wp.cardTitle,
          subject: liveCard?.subject ?? wp.subject,
          card: liveCard,
          items: [wp],
        });
      }
    }

    return Array.from(groups.values());
  }, [visibleItems, cardMap]);

  return (
    <section
      aria-label="수집된 약점 목록 및 약점 재도전"
      className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              약점 목록 · 부족했던 점 집중 재도전
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            백지 인출 검사에서 빠뜨린 개념이 자동으로 수집됩니다. [약점 재도전]으로 부족했던 점만 다시 인출해 극복하면 AI 망각곡선이 위로 회복됩니다.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setFilter('unresolved')}
            className={`px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'unresolved'
                ? 'bg-white text-rose-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            남은 약점 ({unresolvedItems.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('resolved')}
            className={`px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'resolved'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            해결됨 ({resolvedItems.length})
          </button>
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 text-center space-y-2">
          <p className="text-xs sm:text-sm font-semibold text-slate-700">
            {filter === 'unresolved'
              ? '현재 남아 있는 약점이 없습니다.'
              : '아직 약점 재도전으로 해결 완료된 항목이 없습니다.'}
          </p>
          <p className="text-xs text-slate-500">
            {filter === 'unresolved'
              ? '학습 카드에서 [백지 인출]을 실행하고 [검사하기]를 누르면 부족했던 점이 이곳에 모입니다.'
              : '남은 약점을 선택해 [약점 재도전]을 통과하면 해결됨 목록으로 이동합니다.'}
          </p>
          {filter === 'unresolved' && cards[0] && (
            <button
              type="button"
              onClick={() => onStartBlankPage(cards[0])}
              className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors cursor-pointer"
            >
              <span>{cards[0].title} 백지 인출 시작하기</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {groupedByCard.map((group) => (
            <div
              key={group.cardId}
              className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="font-semibold text-blue-700">{group.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums font-medium">
                      {filter === 'unresolved'
                        ? `남은 약점 ${group.items.length}개`
                        : `해결됨 ${group.items.length}개`}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 truncate mt-0.5">
                    {group.cardTitle}
                  </h3>
                </div>

                {group.card && filter === 'unresolved' && (
                  <button
                    type="button"
                    onClick={() => onStartWeaknessRetry(group.card!)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>약점 재도전 ({group.items.length}개)</span>
                  </button>
                )}
              </div>

              <ul className="space-y-2">
                {group.items.map((wp) => (
                  <li
                    key={wp.id}
                    className={`p-3 rounded-xl border bg-white flex items-start justify-between gap-3 ${
                      wp.resolved ? 'border-emerald-200' : 'border-slate-200'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {wp.resolved ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>해결됨</span>
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              wp.severity === 'high' ? 'text-rose-700' : 'text-amber-700'
                            }`}
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{wp.severity === 'high' ? '핵심 보완' : '세부 보완'}</span>
                          </span>
                        )}
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-bold text-slate-900">{wp.concept}</span>
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed">{wp.detail}</p>

                      <div className="text-[11px] text-slate-400 tabular-nums">
                        {wp.createdAtLabel}
                        {wp.attemptCount > 0 && ` · 재도전 ${wp.attemptCount}회`}
                        {wp.resolved && wp.resolvedAtLabel && ` · ${wp.resolvedAtLabel} 해결`}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onDeleteWeakPoint(wp.id)}
                      aria-label={`${wp.concept} 약점 항목 삭제`}
                      title="약점 항목 삭제"
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
