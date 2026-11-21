import { MOODS, type MoodId } from '../copy';

export function MoodBoard({
  value,
  onChange,
}: {
  value: MoodId | null;
  onChange: (mood: MoodId) => void;
}) {
  return (
    <div className="moods" role="group" aria-label="How are you today?">
      {MOODS.map((mood) => (
        <button
          key={mood.id}
          type="button"
          className="mood"
          aria-pressed={value === mood.id}
          onClick={() => onChange(mood.id)}
        >
          <MoodArt id={mood.id} />
          <b>{mood.label}</b>
          <small>{mood.hint}</small>
        </button>
      ))}
    </div>
  );
}

function MoodArt({ id }: { id: MoodId }) {
  const common = { viewBox: '0 0 120 48', fill: 'none', 'aria-hidden': true as const };
  if (id === 'sunny') {
    return (
      <svg {...common}>
        <circle cx="28" cy="24" r="10" fill="currentColor" />
        <path d="M8 40h40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M52 34c8 8 22 8 36-2" stroke="currentColor" strokeWidth="3" fill="none" />
      </svg>
    );
  }
  if (id === 'steady') {
    return (
      <svg {...common}>
        <path d="M8 32h104" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <rect x="48" y="14" width="16" height="18" stroke="currentColor" strokeWidth="3" />
        <path d="M46 14l10-8 10 8" stroke="currentColor" strokeWidth="3" fill="none" />
      </svg>
    );
  }
  if (id === 'tired') {
    return (
      <svg {...common}>
        <path d="M34 10a14 14 0 1 0 0 28 18 18 0 1 1 0-28z" fill="currentColor" />
        <path d="M62 36h40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'uneasy') {
    return (
      <svg {...common}>
        <path
          d="M18 30c0-8 6-12 12-12 4 0 6 2 8 2s4-2 8-2c8 0 14 6 14 13H18z"
          fill="currentColor"
        />
        <path
          d="M48 22c2-7 8-12 15-12 5 0 8 3 10 3 7 0 13 6 13 13H58"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="46" cy="26" r="12" fill="currentColor" />
      <circle cx="66" cy="22" r="10" fill="currentColor" opacity="0.85" />
    </svg>
  );
}
