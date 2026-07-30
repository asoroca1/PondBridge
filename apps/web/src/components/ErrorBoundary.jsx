import { Component } from "react";
import {
  attemptAutomaticChunkRecovery,
  isLikelyMissingChunkError,
  loadLatestBuild,
  recoverFromMissingChunk
} from "../lib/chunkRecovery.js";

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
    this.state = { hasError: false, error: null, recoveringUpdate: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, recoveringUpdate: false };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[ErrorBoundary:${this.props.level || "page"}]`, error, errorInfo);
    if (isLikelyMissingChunkError(error)) {
      if (attemptAutomaticChunkRecovery(error)) {
        this.setState({ recoveringUpdate: true });
      }
      return;
    }
    recoverFromMissingChunk(error);
  }

  handleRetry = () => {
    if (isLikelyMissingChunkError(this.state.error)) {
      loadLatestBuild();
      return;
    }
    this.setState({ hasError: false, error: null, recoveringUpdate: false });
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
    const missingChunk = isLikelyMissingChunkError(this.state.error);

    if (missingChunk && this.state.recoveringUpdate) {
      return (
        <section className="app-status-shell" aria-live="polite">
          <div className="app-status-card">
            <h1>Updating PondBridge</h1>
            <p>Bringing this screen up to date. You will be right back where you were.</p>
          </div>
        </section>
      );
    }

    if (level === "app") {
      return (
        <section className="app-status-shell is-error">
          <div className="app-status-card">
            <h1>{missingChunk ? "PondBridge needs a quick update" : "Something went wrong"}</h1>
            <p>
              {missingChunk
                ? "We could not finish the update automatically. Your account and data are safe—try the update once more."
                : "The application encountered an unexpected error. This has been logged and we apologize for the inconvenience."}
            </p>
            {process.env.NODE_ENV !== "production" && (
              <pre className="eb-detail">{message}</pre>
            )}
            <div className="eb-actions">
              <button className="eb-btn eb-btn--primary" onClick={missingChunk ? loadLatestBuild : this.handleReload}>
                {missingChunk ? "Try update again" : "Reload Page"}
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (level === "section") {
      return (
        <div className="eb-inline">
          <p className="eb-inline-msg">
            {missingChunk ? "This section needs the latest PondBridge update." : "Something went wrong loading this section."}
          </p>
          <button className="eb-btn eb-btn--small" onClick={this.handleRetry}>
            {missingChunk ? "Update" : "Retry"}
          </button>
        </div>
      );
    }

    // Default: page-level
    return (
      <section className="app-status-shell is-error">
        <div className="app-status-card">
          <h1>{missingChunk ? "PondBridge needs a quick update" : "Something went wrong"}</h1>
          <p>
            {missingChunk
              ? "PondBridge could not finish updating this page automatically. Your account and data are safe."
              : "This page encountered an error. You can try again or go back."}
          </p>
          {process.env.NODE_ENV !== "production" && (
            <pre className="eb-detail">{message}</pre>
          )}
          <div className="eb-actions">
            <button className="eb-btn eb-btn--primary" onClick={this.handleRetry}>
              {missingChunk ? "Try update again" : "Try Again"}
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
