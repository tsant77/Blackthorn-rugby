import { Link } from "react-router-dom";

export function LoginPage() {
  const error = new URLSearchParams(window.location.search).get("error");
  return <main className="auth-page">
    <header className="flex items-center gap-s2">
      <img src="/brand/logo.jpg" alt="Blackthorn Rugby Club crest" className="h-12 w-auto rounded-md bg-white p-half" />
      <div><p className="eyebrow">BLACKTHORN RUGBY</p><h1 className="font-heading text-2xl font-semibold">Offseason</h1></div>
    </header>
    <section className="panel"><h2 className="font-heading text-xl font-semibold">Welcome back</h2>
      {error ? <p role="alert" className="error-banner">That link is invalid, expired, or revoked. Ask for a replacement.</p> : null}
      <p>Open your saved personal login link to sign in on this device.</p>
      <p className="text-sm text-quiet">No email or password needed. You stay signed in across normal visits.</p>
      <p className="text-sm text-quiet">Lost your link or changed devices? Ask a coach or administrator to replace your personal link. They will verify who you are first.</p>
    </section>
    <p className="text-sm text-quiet">New player? Open the team registration link from WhatsApp. It creates a new account; it cannot sign in to an existing account.</p>
    <Link to="/player-login" className="text-sm text-sage underline">Use a personal login link</Link>
  </main>;
}
