import { Component } from "react";
import { recoverFromMissingChunk } from "../lib/chunkRecovery.js";

/**
 * Catches render errors in child components and displays a recovery UI
 * instead of white-screening the entire app.
 *
 * Usage:
 *   <ErrorBoundary level="page">
 *     <SomeComponent />
 *   </ErrorBoundary>
 *
 * Levels:
 *   "app"     – top-level boundary, shows full-page error with reload
 *   "page"    – page-level boundary, shows card with back/retry
 *   "section" – inline boundary, shows compact message with retry
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[ErrorBoundary:${this.props.level || "page"}]`, error, errorInfo);
    recoverFromMissingChunk(error);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/";
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const level = this.props.level || "page";
    const message =
      this.state.error?.message || "An unexpected error occurred.";

    if (level === "app") {
      return (
        <section className="app-status-shell is-error">
          <div className="app-status-card">
            <h1>Something went wrong</h1>
            <p>
              The application encountered an unexpected error. This has been
              logged and we apologize for the inconvenience.
            </p>
            {process.env.NODE_ENV !== "production" && (
              <pre className="eb-detail">{message}</pre>
            )}
            <div className="eb-actions">
              <button className="eb-btn eb-btn--primary" onClick={this.handleReload}>
                Reload Page
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (level === "section") {
      return (
        <div className="eb-inline">
          <p className="eb-inline-msg">Something went wrong loading this section.</p>
          <button className="eb-btn eb-btn--small" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      );
    }

    // Default: page-level
    return (
      <section className="app-status-shell is-error">
        <div className="app-status-card">
          <h1>Something went wrong</h1>
          <p>
            This page encountered an error. You can try again or go back.
          </p>
          {process.env.NODE_ENV !== "production" && (
            <pre className="eb-detail">{message}</pre>
          )}
          <div className="eb-actions">
            <button className="eb-btn eb-btn--primary" onClick={this.handleRetry}>
              Try Again
            </button>
            <button className="eb-btn" onClick={this.handleGoBack}>
              Go Back
            </button>
          </div>
        </div>
      </section>
    );
  }
}
