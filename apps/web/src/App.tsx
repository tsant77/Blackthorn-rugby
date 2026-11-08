import { Activity, Trophy } from "lucide-react";
import { brand, charcoal, functional } from "./design/tokens";

const swatches = [
  ["Forest", brand.forest, "Club text color"],
  ["Sage", brand.sage, "Club title color"],
  ["Pitch", brand.pitch, "Positive"],
  ["Leaf", brand.leaf, "Deep green"],
  ["Gold", brand.gold, "Restrained accent"],
  ["Gold soft", brand.goldSoft, "Highlight fill"],
  ["Canvas", charcoal.canvas, "App background"],
  ["Raised", charcoal.raised, "Cards"],
  ["Ink", charcoal.ink, "Primary text"],
  ["Muted", charcoal.muted, "Secondary text"],
  ["Danger", functional.danger, "Functional only"],
];

const rows = [
  { rank: "1", name: "Player A", points: "30.0", detail: "4 sessions" },
  { rank: "2", name: "Player B", points: "22.5", detail: "3 sessions" },
  { rank: "3", name: "Player C", points: "18.0", detail: "3 sessions" },
];

export function App() {
  return (
    <div className="min-h-screen bg-canvas pb-32 text-ink">
      <a href="#specimen" className="skip-link rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">
        Skip to specimen
      </a>
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex max-w-5xl items-center gap-s2 px-s2 py-s2">
          <img
            src="/brand/logo.jpg"
            alt="Blackthorn Rugby Club crest"
            width={2479}
            height={2704}
            className="h-16 w-auto rounded-md bg-white p-half"
          />
          <div>
            <p className="font-heading text-sm font-semibold tracking-wide text-sage">Blackthorn Rugby</p>
            <h1 className="font-heading text-2xl font-semibold leading-tight">Offseason performance</h1>
          </div>
        </div>
        <div className="h-1 bg-gold" />
      </header>

      <main id="specimen" className="mx-auto flex max-w-5xl flex-col gap-s4 px-s2 py-s4">
        <p className="max-w-2xl text-quiet">
          Phase 1 design specimen. Product screens are not built yet. Gold is reserved for the primary
          action, points, and the active tab.
        </p>

        <section className="flex flex-col gap-s2" aria-labelledby="colors-heading">
          <h2 id="colors-heading" className="font-heading text-xl font-semibold">
            Color
          </h2>
          <ul className="grid grid-cols-2 gap-s2 sm:grid-cols-3">
            {swatches.map(([name, hex, note]) => (
              <li key={hex + name} className="overflow-hidden rounded-md border border-line bg-raised shadow-card">
                <div className="h-12" style={{ backgroundColor: hex }} />
                <div className="px-s2 py-s1">
                  <p className="font-heading text-sm font-semibold">{name}</p>
                  <p className="font-display text-lg tracking-wide text-gold-soft">{hex}</p>
                  <p className="text-sm text-faint">{note}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-s2" aria-labelledby="type-heading">
          <h2 id="type-heading" className="font-heading text-xl font-semibold">
            Type
          </h2>
          <div className="rounded-md border border-line bg-raised p-s2 shadow-card">
            <p className="font-display text-5xl leading-none text-gold">30.0</p>
            <p className="mt-s1 text-sm text-quiet">Barlow Condensed for scores</p>
            <h3 className="mt-s2 font-heading text-2xl font-semibold">Nunito Sans for headings</h3>
            <p className="mt-s1 max-w-prose text-base">
              Lato for body copy, matching the club site. Headings stay at semibold so they hold up on charcoal.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-s2" aria-labelledby="space-heading">
          <h2 id="space-heading" className="font-heading text-xl font-semibold">
            8-point spacing
          </h2>
          <div className="flex items-end gap-s2 rounded-md border border-line bg-raised p-s2">
            {[
              ["s1", "h-s1"],
              ["s2", "h-s2"],
              ["s3", "h-s3"],
              ["s4", "h-s4"],
            ].map(([label, height]) => (
              <div key={label} className="flex flex-col items-center gap-s1">
                <div className={`${height} w-s2 bg-pitch`} />
                <span className="text-sm text-quiet">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-s2" aria-labelledby="components-heading">
          <h2 id="components-heading" className="font-heading text-xl font-semibold">
            Core components
          </h2>
          <div className="flex flex-wrap gap-s2">
            <button type="button" className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">
              Log workout
            </button>
            <button
              type="button"
              className="rounded-md bg-forest px-s2 py-s1 font-heading font-semibold text-sage"
            >
              Secondary
            </button>
            <button
              type="button"
              className="rounded-md border border-line bg-transparent px-s2 py-s1 font-heading font-semibold text-ink"
            >
              Ghost
            </button>
            <button
              type="button"
              className="rounded-md bg-danger px-s2 py-s1 font-heading font-semibold text-ink"
            >
              Delete
            </button>
          </div>

          <label className="flex max-w-sm flex-col gap-s1 text-sm text-quiet">
            Duration (minutes)
            <input
              className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
              inputMode="numeric"
              defaultValue="40"
            />
          </label>

          <div className="rounded-md border border-gold bg-overlay px-s2 py-s2 text-gold-soft">
            Training is on hold. This session cannot score.
          </div>

          <article className="rounded-md border border-line bg-raised shadow-card">
            <header className="flex items-center justify-between border-b border-line px-s2 py-s1">
              <h3 className="font-heading font-semibold">This week</h3>
              <Trophy className="text-gold" size={18} aria-hidden="true" />
            </header>
            <ol>
              {rows.map((row) => (
                <li key={row.rank} className="flex items-center gap-s2 border-b border-line px-s2 py-s1 last:border-b-0">
                  <span className="w-8 font-display text-2xl text-gold">{row.rank}</span>
                  <span className="flex-1">
                    <span className="block font-heading font-semibold">{row.name}</span>
                    <span className="text-sm text-quiet">{row.detail}</span>
                  </span>
                  <span className="font-display text-2xl">{row.points}</span>
                </li>
              ))}
            </ol>
          </article>
          <p className="text-sm text-faint">
            Placeholder rows only. The roster stays empty until a coach adds players.
          </p>
        </section>
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 border-t border-line bg-raised"
      >
        <ul className="mx-auto grid max-w-5xl grid-cols-4">
          {[
            ["Home", true],
            ["Log", false],
            ["Board", false],
            ["You", false],
          ].map(([label, current]) => (
            <li key={String(label)}>
              <a
                href="#specimen"
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 flex-col items-center justify-center gap-half py-s1 text-sm ${current ? "text-gold" : "text-quiet"}`}
              >
                <Activity size={18} aria-hidden="true" />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
