import { House, Plus, Trophy, UserRound } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useSession } from "../session";

const items = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/log", label: "Log", icon: Plus, end: false },
  { to: "/board", label: "Board", icon: Trophy, end: false },
  { to: "/you", label: "You", icon: UserRound, end: false },
];

export function Shell() {
  const { me } = useSession();
  const staff = me?.membership.role === "admin" || me?.membership.role === "coach";
  if (me?.needsOnboarding) {
    return (
      <div className="min-h-screen bg-canvas text-ink">
        <Header />
        <Outlet />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-canvas text-ink md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-line bg-raised md:flex md:flex-col md:gap-s3 md:px-s2 md:py-s3">
        <Brand />
        <nav aria-label="Primary" className="flex flex-col gap-s1">
          {items.map((item) => (
            <SideLink key={item.to} to={item.to} end={item.end}>{item.label}</SideLink>
          ))}
          <SideLink to="/team">Team</SideLink>
          {staff ? <SideLink to="/squad">Squad</SideLink> : null}
          {me?.membership.role === "admin" ? <SideLink to="/invite">Invite</SideLink> : null}
        </nav>
      </aside>
      <div className="pb-24 md:pb-0">
        <header className="border-b border-line bg-raised md:hidden">
          <div className="px-s2 py-s2">
            <Brand />
          </div>
          <div className="h-1 bg-gold" />
        </header>
        <Outlet />
      </div>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 border-t border-line bg-raised md:hidden">
        <ul className="grid grid-cols-4">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex min-h-11 flex-col items-center justify-center gap-half py-s1 text-sm ${isActive ? "text-gold" : "text-quiet"}`
                }
              >
                <item.icon size={18} aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-line bg-raised">
      <div className="px-s2 py-s2">
        <Brand />
      </div>
      <div className="h-1 bg-gold" />
    </header>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-s2">
      <img src="/brand/logo.jpg" alt="" width={64} height={70} className="h-12 w-auto rounded-md bg-white p-half" />
      <div>
        <p className="font-heading text-sm font-semibold text-sage">Blackthorn Rugby</p>
        <p className="font-heading text-lg font-semibold leading-tight">Offseason</p>
      </div>
    </div>
  );
}

function SideLink({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-md px-s2 py-s1 font-heading font-semibold ${isActive ? "bg-gold text-forest" : "text-ink"}`
      }
    >
      {children}
    </NavLink>
  );
}

export function LoadingScreen() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-s2 px-s2" aria-busy="true">
      <div className="h-s3 w-40 rounded-md bg-raised" />
      <div className="h-s8 rounded-md bg-raised" />
      <p className="text-quiet">Loading the club…</p>
    </main>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s2 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">{title}</h1>
      <section className="rounded-md border border-line bg-raised p-s2 shadow-card">
        <p className="text-quiet">{body}</p>
      </section>
    </main>
  );
}
