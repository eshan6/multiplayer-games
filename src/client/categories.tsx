/**
 * Visual identity for the ten categories.
 *
 * Each gets a hue and a drawn mark. The marks are geometric and built from the
 * category's own subject matter — an orbit for science, a contour for
 * geography, a circuit trace for tech. They are rendered oversized and clipped
 * by the plate, so what identifies a category is the shape, not a badge.
 *
 * Categories are keyed by the bank's own ids. A category the bank adds later
 * still renders, with a neutral hue and the fallback mark.
 */
import type { JSX } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' } as const;

const marks: Record<string, JSX.Element> = {
  // Orbits around a nucleus.
  science: (
    <>
      <circle cx="24" cy="24" r="4" fill="currentColor" stroke="none" />
      <ellipse cx="24" cy="24" rx="19" ry="8" {...S} />
      <ellipse cx="24" cy="24" rx="19" ry="8" {...S} transform="rotate(60 24 24)" />
      <ellipse cx="24" cy="24" rx="19" ry="8" {...S} transform="rotate(120 24 24)" />
    </>
  ),
  // A triumphal arch on a plinth.
  history: (
    <>
      <path d="M11 40V22a13 13 0 0 1 26 0v18" {...S} />
      <path d="M7 40h34" {...S} />
      <path d="M18 40V24a6 6 0 0 1 12 0v16" {...S} />
      <path d="M13 14h22" {...S} />
    </>
  ),
  // Contour lines of a landform.
  geography: (
    <>
      <path d="M6 34c6-7 12-3 17-8s10-9 19-4" {...S} />
      <path d="M9 41c6-7 11-4 16-9s10-8 17-4" {...S} />
      <path d="M14 27c4-5 8-2 12-6s7-6 13-3" {...S} />
      <circle cx="30" cy="17" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  // A circuit trace with pads.
  tech: (
    <>
      <path d="M6 15h11l6 6h9" {...S} />
      <path d="M6 33h15l6-6h9" {...S} />
      <path d="M32 21v-9" {...S} />
      <circle cx="36" cy="21" r="3.4" {...S} />
      <circle cx="36" cy="27" r="3.4" {...S} />
      <circle cx="32" cy="10" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Ascending bars with a break in the trend.
  business: (
    <>
      <path d="M8 40V27" {...S} />
      <path d="M18 40V19" {...S} />
      <path d="M28 40V31" {...S} />
      <path d="M38 40V11" {...S} />
      <path d="M8 21l10-8 10 9 10-12" {...S} strokeWidth={2} opacity={0.55} />
    </>
  ),
  // A burst, like a flashbulb.
  popculture: (
    <>
      <circle cx="24" cy="24" r="7" {...S} />
      <path d="M24 5v7M24 36v7M5 24h7M36 24h7" {...S} />
      <path d="M11 11l5 5M32 32l5 5M37 11l-5 5M16 32l-5 5" {...S} />
    </>
  ),
  // A spiral turning inward.
  mind: (
    <path
      d="M31 24a7 7 0 1 1-7-7 11 11 0 1 1-11 11 15 15 0 1 1 15-15 19 19 0 0 1 3 1"
      {...S}
    />
  ),
  // A bowl with rising steam.
  food: (
    <>
      <path d="M8 24h32a16 16 0 0 1-32 0Z" {...S} />
      <path d="M5 42h38" {...S} />
      <path d="M18 14c0-3 3-3 3-6M27 14c0-3 3-3 3-6" {...S} strokeWidth={2} />
    </>
  ),
  // Dice five.
  games: (
    <>
      <rect x="8" y="8" width="32" height="32" rx="7" {...S} />
      <circle cx="17" cy="17" r="2.7" fill="currentColor" stroke="none" />
      <circle cx="31" cy="17" r="2.7" fill="currentColor" stroke="none" />
      <circle cx="24" cy="24" r="2.7" fill="currentColor" stroke="none" />
      <circle cx="17" cy="31" r="2.7" fill="currentColor" stroke="none" />
      <circle cx="31" cy="31" r="2.7" fill="currentColor" stroke="none" />
    </>
  ),
  // A scatter that refuses to line up.
  wildcards: (
    <>
      <path d="M24 7v34M7 24h34" {...S} />
      <path d="M12 12l24 24M36 12L12 36" {...S} opacity={0.5} />
      <circle cx="24" cy="24" r="4.5" fill="currentColor" stroke="none" />
    </>
  ),
};

const fallbackMark = (
  <>
    <circle cx="24" cy="24" r="15" {...S} />
    <path d="M24 31v-2a5 5 0 1 0-5-5" {...S} />
    <circle cx="24" cy="36" r="1.8" fill="currentColor" stroke="none" />
  </>
);

const hues: Record<string, string> = {
  science: '#4adede',
  history: '#e8a33d',
  geography: '#7bd389',
  tech: '#8b9dff',
  business: '#f5d547',
  popculture: '#ff6b9d',
  mind: '#b78bff',
  food: '#ff8c5a',
  games: '#5aa9ff',
  wildcards: '#e85d75',
};

export function hueFor(categoryId: string): string {
  return hues[categoryId] ?? '#90a3c1';
}

export function CategoryMark({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" strokeLinejoin="round">
      {marks[id] ?? fallbackMark}
    </svg>
  );
}
