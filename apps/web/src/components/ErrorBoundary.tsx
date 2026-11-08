import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: Error): State {
    return { message: error.message || "Something went wrong." };
  }

  render() {
    if (this.state.message) {
      return (
        <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-s2 bg-canvas px-s2 text-ink">
          <h1 className="font-heading text-2xl font-semibold">This screen hit a problem</h1>
          <p className="text-quiet">{this.state.message}</p>
          <button
            type="button"
            className="w-fit rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest"
            onClick={() => {
              this.setState({ message: null });
              window.location.assign("/");
            }}
          >
            Back to home
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
