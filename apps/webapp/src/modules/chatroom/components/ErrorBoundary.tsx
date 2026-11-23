'use client';

import { AlertTriangle } from 'lucide-react';
import React, { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * Optional. While the boundary shows its fallback, a change to this value clears the
   * error and renders children again. Callers that omit it keep the error until remount.
   */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  resetKey: string | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { hasError: false, error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Dashboard error:', error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error">
          <div className="error-icon">
            <AlertTriangle size={24} />
          </div>
          <div>Something went wrong</div>
          <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '10px 20px',
              background: 'var(--accent)',
              color: 'var(--bg-primary)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
