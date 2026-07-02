'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Brand, Card, Chip, Button } from '@/components/ui';

const TRAILER_YOUTUBE_ID = 'ph13qlNgtEY';

const MINI_GAMES = [
  ['Start Lights', 'React the moment the five lights go out. Beat your best launch time.'],
  ['Pit Stop', 'Tap each wheel in sync and nail a clean four-wheel stop.'],
  ['Grid Dash', 'Weave through traffic and overtake without making contact.'],
  ['Strategy Recall', 'Memorise the tyre order and play it back from memory.'],
];

const IOS_STEPS = [
  'Open motorsport-iq.vercel.app in Safari.',
  'Tap the Share button (the square with an arrow pointing up).',
  'Scroll down and tap "Add to Home Screen".',
  'Tap "Add" in the top corner. The icon now lives on your home screen.',
];

const ANDROID_STEPS = [
  'Open motorsport-iq.vercel.app in Chrome.',
  'Tap the three-dot menu in the top corner.',
  'Tap "Add to Home screen" (or "Install app").',
  'Confirm, and the icon drops onto your home screen.',
];

export default function GuidePage() {
  const [platform, setPlatform] = useState<'ios' | 'android'>('ios');
  const steps = platform === 'ios' ? IOS_STEPS : ANDROID_STEPS;

  return (
    <main className="app-bg pad-safe-top pad-safe-bottom relative min-h-dvh px-5 pb-16">
      <div className="speed-lines pointer-events-none absolute inset-x-0 top-0 z-0 h-56 opacity-60" />

      {/* Top bar */}
      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between py-5">
        <Brand />
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-faint-fg)] transition-colors hover:text-[var(--color-fg)]"
        >
          <span className="text-base">←</span> Back to play
        </Link>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="animate-fade-up pt-4 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <Chip tone="accent">The Guide</Chip>
            <Chip tone="warn">Beta</Chip>
          </div>
          <h1 className="font-display text-[2.6rem] font-bold uppercase leading-[0.95] tracking-tight sm:text-6xl">
            F1 is better
            <br />
            <span className="text-[var(--color-accent)]">when you play along.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[var(--color-muted-fg)] sm:text-lg">
            Motorsport IQ turns any Grand Prix into a live prediction game you play with
            friends. No more zoning out during a quiet middle stint. Read the race, call what
            happens next, and prove who actually knows their stuff.
          </p>
        </section>

        {/* ── Trailer ───────────────────────────────────────────────────── */}
        <section className="animate-fade-up delay-1 mt-10">
          <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-black shadow-[var(--shadow-lg)]">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${TRAILER_YOUTUBE_ID}?rel=0&modestbranding=1`}
              title="Motorsport IQ trailer"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <p className="mt-3 text-center text-xs text-[var(--color-faint-fg)]">
            Tap play to watch. Use the player controls to pause, mute, or go full screen.
          </p>
        </section>

        {/* ── Why it matters ────────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="01" title="Why we built this" />
          <Card tone="elevated" className="mt-5">
            <p className="text-base leading-relaxed text-[var(--color-muted-fg)] sm:text-lg">
              Every fan knows the feeling. The race starts, the first laps are electric, and
              then the field settles. Cars spread out, the leader pulls a gap, and for twenty
              laps not much happens on screen. That is usually when people grab their phone and
              drift away.
            </p>
            <p className="mt-4 text-base leading-relaxed text-[var(--color-muted-fg)] sm:text-lg">
              We wanted to fix that quiet middle. Motorsport IQ reads the live race data and
              fires short, sharp questions at the moments that actually matter. Will this driver
              pit in the next 3 laps? Will that gap close before the chequered flag? You get 45
              seconds to commit, your friends do too, and suddenly the &quot;boring&quot; stint
              is the most fun part of your watch party.
            </p>
          </Card>
        </section>

        {/* ── How a game works ──────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="02" title="How a game works" />
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <StepCard
              n="1"
              title="Join a lobby"
              body="Pick a race, choose solo or a private room with friends, and you are in. No sign up, just a driver name."
            />
            <StepCard
              n="2"
              title="Answer live prompts"
              body="As the race unfolds, yes or no questions pop up. You have 45 seconds to lock your call before it closes."
            />
            <StepCard
              n="3"
              title="Climb the board"
              body="Correct calls score points, streaks earn bonuses, and the live leaderboard updates after every result."
            />
          </div>
          <Card className="mt-4">
            <p className="text-sm leading-relaxed text-[var(--color-muted-fg)]">
              Everything is decided by the real race. We never make up outcomes. Questions only
              resolve once a lap is actually complete, so the scoreboard always reflects what
              truly happened on track. A typical Grand Prix gives you somewhere between 8 and 15
              questions across the race.
            </p>
          </Card>
        </section>

        {/* ── Replay vs Live ────────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="03" title="Live races and replay races" />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Card tone="elevated">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 animate-flash rounded-full bg-[var(--color-go)]" />
                <h3 className="font-display text-xl font-bold uppercase tracking-wide">
                  Live races
                </h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-fg)]">
                When a real Grand Prix is on, the game runs in real time alongside the broadcast.
                The lobby opens 45 minutes before lights out, so you can get your friends in,
                pick your name, and settle in early. When the race starts, everyone drops into
                the action together and questions begin once the opening laps are done.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-fg)]">
                Turn on race alerts and we will remind you before every live session so you never
                miss the start.
              </p>
            </Card>
            <Card tone="elevated">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
                <h3 className="font-display text-xl font-bold uppercase tracking-wide">
                  Replay races
                </h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-fg)]">
                No race on this weekend? Pick any past Grand Prix and play it back from the start.
                Replays use the real telemetry from that day, so the questions and results match
                exactly what happened. It is the perfect way to learn the game, settle a rivalry,
                or just relive a classic with your mates.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-fg)]">
                Choose a year, pick a race, and start whenever you want. No schedule required.
              </p>
            </Card>
          </div>
        </section>

        {/* ── Private vs Public lobbies ─────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="04" title="Private and public lobbies" />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Card tone="elevated">
              <Chip tone="accent" className="mb-3">Play with friends</Chip>
              <h3 className="font-display text-xl font-bold uppercase tracking-wide">
                Private lobbies
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-fg)]">
                Create a private room and share the 6 character code with your friends. Only
                people with the code can join, so it is just your crew on the board. Perfect for
                a watch party, a group chat rivalry, or settling who really is the smartest fan.
              </p>
            </Card>
            <Card tone="elevated">
              <Chip tone="info" className="mb-3">Play solo</Chip>
              <h3 className="font-display text-xl font-bold uppercase tracking-wide">
                Public lobbies
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-fg)]">
                Don&apos;t have friends watching right now? Jump into a shared public lobby and
                go head to head with other fans from anywhere. Same race, same questions, one big
                leaderboard. A great way to test your instincts against strangers.
              </p>
            </Card>
          </div>
          <Card className="mt-4">
            <p className="text-sm leading-relaxed text-[var(--color-muted-fg)]">
              Whether you are up against friends or strangers, the leaderboard is pure race IQ.
              There is no luck spinner and no pay to win. The fans who read the race best, time
              their calls, and build streaks rise to the top. Climb the board and earn your
              bragging rights.
            </p>
          </Card>
        </section>

        {/* ── Memes ─────────────────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="05" title="A meme for every call" />
          <Card tone="elevated" className="mt-5">
            <p className="text-base leading-relaxed text-[var(--color-muted-fg)] sm:text-lg">
              Get it right and we celebrate with you. Get it wrong and we will roast you a little.
              After every question we drop a fresh F1 meme based on how you did. It keeps the mood
              light, the group chat loud, and the wrong answers a lot less painful.
            </p>
          </Card>
        </section>

        {/* ── Mini-games ────────────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="06" title="Four mini-games to keep you sharp" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-muted-fg)]">
            Waiting for the next question or the next race to start? The Pit Wall Arcade lives
            right inside the game window, so you are never just staring at a quiet track. Four
            quick games, your best scores saved on your device.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MINI_GAMES.map(([name, body], i) => (
              <Card key={name} tone="elevated" className="flex flex-col gap-2">
                <span className="font-display text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  0{i + 1}
                </span>
                <h3 className="font-display text-lg font-bold uppercase leading-tight tracking-wide">
                  {name}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--color-muted-fg)]">{body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Add to home screen ────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="07" title="Put us on your home screen" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-muted-fg)]">
            Motorsport IQ runs best as an app on your phone. It opens full screen, loads faster,
            and feels like the real thing. You can add it straight from your browser in a few
            seconds, no app store needed.
          </p>
          <Card tone="elevated" className="mt-5">
            <div className="mb-5 inline-flex rounded-[var(--radius-pill)] border border-[var(--color-border-strong)] bg-[var(--color-bg)] p-1">
              <button
                type="button"
                onClick={() => setPlatform('ios')}
                className={`rounded-[var(--radius-pill)] px-5 py-2 font-display text-sm font-bold uppercase tracking-wide transition-colors ${
                  platform === 'ios'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]'
                }`}
              >
                iPhone
              </button>
              <button
                type="button"
                onClick={() => setPlatform('android')}
                className={`rounded-[var(--radius-pill)] px-5 py-2 font-display text-sm font-bold uppercase tracking-wide transition-colors ${
                  platform === 'android'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]'
                }`}
              >
                Android
              </button>
            </div>
            <ol className="space-y-3">
              {steps.map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] font-display text-sm font-bold text-[var(--color-accent)]">
                    {i + 1}
                  </span>
                  <p className="pt-0.5 text-sm leading-relaxed text-[var(--color-muted-fg)]">
                    {step}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </section>

        {/* ── Notifications ─────────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="08" title="Turn on notifications" />
          <Card tone="elevated" className="mt-5">
            <p className="text-base leading-relaxed text-[var(--color-muted-fg)] sm:text-lg">
              Enable notifications and we will give you a heads up about 30 minutes before every
              live race, so you and your friends can be ready at the lights. We will also nudge
              you the moment a new question appears, even if you have switched to another tab or
              app. That way you never miss a call while you are checking the timing screen or
              replying to the group chat.
            </p>
          </Card>
        </section>

        {/* ── Beta + feedback ───────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="09" title="We are still in Beta" />
          <Card tone="elevated" className="mt-5">
            <p className="text-base leading-relaxed text-[var(--color-muted-fg)] sm:text-lg">
              Motorsport IQ is a young, fan made project and we are not perfect yet. You might hit
              the odd rough edge, and that is okay. We are improving it race by race. If something
              breaks, feels off, or you have an idea that would make it better, please tell us. Your
              feedback genuinely shapes what we build next, and the reviews keep us going.
            </p>
          </Card>
        </section>

        {/* ── Contact ───────────────────────────────────────────────────── */}
        <section className="mt-16">
          <SectionHeading kicker="10" title="Say hello" />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ContactCard
              label="Email"
              value="motorsportiq5@gmail.com"
              href="mailto:motorsportiq5@gmail.com"
              icon={<GmailIcon />}
            />
            <ContactCard
              label="YouTube"
              value="@Motorsport-IQ"
              href="https://www.youtube.com/@Motorsport-IQ"
              icon={<YouTubeIcon />}
            />
            <ContactCard
              label="LinkedIn"
              value="Motorsport IQ"
              href="https://www.linkedin.com/company/motorsport-iq"
              icon={<LinkedInIcon />}
            />
            <ContactCard
              label="Instagram"
              value="@motorsport_iq"
              href="https://www.instagram.com/motorsport_iq"
              icon={<InstagramIcon />}
            />
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────────────────── */}
        <section className="mt-16 text-center">
          <h2 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">
            Ready to call the race?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-[var(--color-muted-fg)]">
            Grab a driver name, pick a race, and see if your instincts hold up.
          </p>
          <Link href="/" className="mt-6 inline-block">
            <Button size="lg" className="text-base font-bold">
              Start playing
            </Button>
          </Link>
        </section>

        {/* ── Disclaimer ────────────────────────────────────────────────── */}
        <footer className="mt-16 border-t border-[var(--color-border)] pt-8">
          <p className="mx-auto max-w-3xl text-center text-xs leading-relaxed text-[var(--color-faint-fg)]">
            Motorsport IQ is an independent fan project. It is not associated with, authorised by,
            endorsed by, or in any way officially connected to Formula 1, Formula One Licensing BV,
            the FIA, or any related companies. F1, FORMULA 1, FORMULA ONE, and related marks are
            trademarks of their respective owners. All trademarks belong to their respective owners
            and are used here for identification purposes only.
          </p>
        </footer>
      </div>
    </main>
  );
}

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="flex items-end gap-3">
      <span className="font-display text-3xl font-bold leading-none text-[var(--color-accent)] sm:text-4xl">
        {kicker}
      </span>
      <h2 className="font-display text-2xl font-bold uppercase leading-none tracking-tight sm:text-3xl">
        {title}
      </h2>
    </div>
  );
}

function StepCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <Card tone="elevated" className="flex flex-col gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent-soft)] font-display text-base font-bold text-[var(--color-accent)]">
        {n}
      </span>
      <h3 className="font-display text-lg font-bold uppercase tracking-wide">{title}</h3>
      <p className="text-sm leading-relaxed text-[var(--color-muted-fg)]">{body}</p>
    </Card>
  );
}

function ContactCard({
  label,
  value,
  href,
  icon,
}: {
  label: string;
  value: string;
  href: string;
  icon: React.ReactNode;
}) {
  const isExternal = href.startsWith('http');
  return (
    <a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className="group block rounded-[var(--radius)] border border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-elevated),var(--color-panel))] p-5 shadow-[var(--shadow)] transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-white/95 shadow-sm">
        {icon}
      </span>
      <p className="mt-3 font-display text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-faint-fg)]">
        {label}
      </p>
      <p className="mt-1 break-words text-base font-semibold text-[var(--color-fg)] transition-colors group-hover:text-[var(--color-accent)]">
        {value}
      </p>
    </a>
  );
}

function GmailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden>
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7a3 3 0 0 0 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2L24 19.45 13 11.2 12 17l1 6.7 11 8.25 11-8.25L36 17z" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 45 12.298z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#ff0000"
        d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8z"
      />
      <path fill="#fff" d="M9.6 15.6V8.4l6.2 3.6z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#0a66c2"
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"
      />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <defs>
        <radialGradient id="ig-grad" cx="0.3" cy="1" r="1.1">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="20%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="70%" stopColor="#d6249f" />
          <stop offset="100%" stopColor="#285aeb" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#ig-grad)" />
      <circle cx="12" cy="12" r="5" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="18" cy="6" r="1.4" fill="#fff" />
    </svg>
  );
}
