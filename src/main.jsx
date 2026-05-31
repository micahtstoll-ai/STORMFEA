import { Component } from "react";
import { createRoot } from "react-dom/client";
import FEATool from "../FEATool.jsx";

class StartupErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Stressform startup error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#09090b",
            color: "#e06060",
            font: "13px Courier New, monospace",
            padding: 24,
            whiteSpace: "pre-wrap",
          }}
        >
          {`Stressform failed to start:\n\n${this.state.error?.stack || this.state.error?.message || String(this.state.error)}`}
        </div>
      );
    }

    return this.props.children;
  }
}

try {
  createRoot(document.getElementById("root")).render(
    <StartupErrorBoundary>
      <FEATool />
    </StartupErrorBoundary>,
  );
} catch (error) {
  document.getElementById("root").innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#e06060;font:12px Courier New,monospace;padding:24px;white-space:pre-wrap">
      Stressform failed to start:\n${error instanceof Error ? error.message : String(error)}
    </div>
  `;
  throw error;
}
