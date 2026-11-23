import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || '예기치 않은 오류가 발생했습니다.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-base font-bold">데이터 동기화 중 오류가 발생했습니다</h2>
            </div>
            <p className="text-xs text-slate-600 break-words bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono-tabular">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>페이지 새로고침</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
