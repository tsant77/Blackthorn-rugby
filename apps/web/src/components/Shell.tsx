import { useRef, useLayoutEffect, useState, useEffect } from "react";
import { Menu, X, House, Plus, Trophy, UserRound } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../session";
import { api } from "../api";

const items = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/log", label: "Log", icon: Plus, end: false },
  { to: "/board", label: "Board", icon: Trophy, end: false },
  { to: "/you", label: "You", icon: UserRound, end: false },
];

export function Shell() {
  const { me } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [announce, setAnnounce] = useState(false);
  useEffect(() => { if (!me?.needsOnboarding && !me?.pendingApproval) void api<{show:boolean}>("/api/suggestions/announcement").then(r => setAnnounce(r.show)).catch(() => {}); }, [me?.user.id,me?.needsOnboarding,me?.pendingApproval]);
  async function dismissAnnouncement(){setAnnounce(false);try{await api("/api/suggestions/announcement/dismiss",{method:"POST"})}catch{setAnnounce(true)}}
  const menu = useRef<HTMLDialogElement>(null);
  const { pathname } = useLocation();
  const route = useRef(pathname);
  route.current = pathname;
  useLayoutEffect(() => {
    if (!menuOpen) { menu.current?.close(); return; }
    const scroll = window.scrollY, openedOn = route.current;
    const previous = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scroll}px`;
    document.body.style.width = "100%";
    menu.current?.showModal();
    return () => {
      Object.assign(document.body.style, previous);
      window.scrollTo({ top: route.current === openedOn ? scroll : 0, behavior: "instant" });
    };
  }, [menuOpen]);
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
          <SideLink to="/challenges">Challenges</SideLink>
          <SideLink to="/inbox">Inbox</SideLink>
          <SideLink to="/suggestions">Suggestions</SideLink>
          {staff ? <SideLink to="/moderate">Moderate</SideLink> : null}
          {staff ? <SideLink to="/members">Members</SideLink> : null}
          {me?.membership.role === "admin" ? <SideLink to="/rules">Rules</SideLink> : null}
          {me?.membership.role === "admin" ? <SideLink to="/scoring-settings">Scoring Settings</SideLink> : null}
          {staff ? <SideLink to="/squad">Squad</SideLink> : null}
          {me?.membership.role === "admin" ? <SideLink to="/registration">Registration</SideLink> : null}
          {me?.membership.role === "admin" ? <SideLink to="/invite">Invite</SideLink> : null}
        </nav>
      </aside>
      <div className="shell-content">
        <header className="mobile-header md:hidden">
          <Brand />
          <button type="button" className="menu-toggle" aria-label="Open club menu" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={22} /></button>
        </header>
        <dialog ref={menu} aria-label="Club menu" className="club-menu" onCancel={() => setMenuOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
          <div className="flex items-center justify-between border-b border-line pb-s2">
            <h2 className="font-heading text-lg font-semibold">Club menu</h2>
            <button type="button" className="menu-toggle" aria-label="Close club menu" onClick={() => setMenuOpen(false)}><X /></button>
          </div>
          <nav aria-label="Club" className="mt-s2 flex flex-col gap-s1" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) setMenuOpen(false); }}>
            <SideLink to="/team">Team</SideLink>
            <SideLink to="/challenges">Challenges</SideLink>
            <SideLink to="/inbox">Inbox</SideLink>
            <SideLink to="/suggestions">Suggestions</SideLink>
            {staff ? <SideLink to="/moderate">Moderate</SideLink> : null}
            {staff ? <SideLink to="/members">Members</SideLink> : null}
            {me?.membership.role === "admin" ? <SideLink to="/rules">Rules</SideLink> : null}
          {me?.membership.role === "admin" ? <SideLink to="/scoring-settings">Scoring Settings</SideLink> : null}
            {staff ? <SideLink to="/squad">Squad</SideLink> : null}
            {me?.membership.role === "admin" ? <SideLink to="/registration">Registration</SideLink> : null}
          {me?.membership.role === "admin" ? <SideLink to="/invite">Invite</SideLink> : null}
          </nav>
        </dialog>
        {pathname === "/" ? <div className="mx-auto max-w-lg px-s2 pt-s2"><Link to="/suggestions" className="block rounded-md border border-gold bg-raised p-s2 text-sm"><strong>💡 Have an idea?</strong> Share feedback and vote on team suggestions →</Link></div> : null}
        <Outlet />
        {announce && pathname === "/" ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-s3"><section role="dialog" aria-modal="true" aria-label="New team suggestions feature" className="w-full max-w-sm rounded-lg border border-gold bg-raised p-s3 text-ink shadow-xl"><h2 className="font-heading text-xl font-semibold">💡 Team Suggestions are here!</h2><p className="my-s2">Share ideas, report bugs, and vote on improvements to Blackthorn Rugby.</p><div className="flex flex-wrap gap-s2"><Link className="save-workout" to="/suggestions" onClick={()=>void dismissAnnouncement()}>Share an idea</Link><button className="secondary-button" type="button" onClick={()=>void dismissAnnouncement()}>Not now</button></div></section></div> : null}
      </div>
      <nav aria-label="Primary" className="bottom-nav fixed inset-x-0 bottom-0 border-t border-line bg-raised md:hidden">
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
      <img src="/brand/logo.jpg" alt="" width={64} height={70} className="h-10 w-auto rounded-md bg-white p-half" />
      <div>
        <p className="font-heading text-sm font-semibold text-sage">Blackthorn Rugby</p>
        <p className="font-heading text-sm font-semibold leading-tight">OFFSEASON TRAINING</p>
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
