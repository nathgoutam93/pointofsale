import { Component, type ReactNode } from "react";
import { reportCrash } from "../lib/crash";

/** A screen that crashed while drawing: reported, with a way back instead of a blank window. */
export class CrashBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportCrash(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="card max-w-md p-6 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong on this screen</h1>
          <p className="mt-2 text-sm text-slate-600">
            Open bills and saved drafts are kept. Reload to carry on; if it happens again, tell your support with what you were doing.
          </p>
          <button className="btn-primary mt-4" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
