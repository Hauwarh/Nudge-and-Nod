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
          className={`mood mood-${mood.id}`}
          aria-pressed={value === mood.id}
          aria-label={`${mood.label}. ${mood.hint}`}
          onClick={() => onChange(mood.id)}
        >
          <MoodArt id={mood.id} />
          <b>{mood.label}</b>
          <span className="tick" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Flat, chunky scenes. No faces: a face is not a feeling, and the person picks the scene. */
export function MoodArt({ id, className = 'mood-art' }: { id: MoodId; className?: string }) {
  const common = { viewBox: '0 0 96 72', className, 'aria-hidden': true as const };
  if (id === 'sunny') {
    return (
      <svg {...common}>
        <g className="rays" stroke="#C9761A" strokeWidth="4" strokeLinecap="round">
          <path d="M48 6v8M22 16l6 6M74 16l-6 6M12 40h8M76 40h8" />
        </g>
        <circle cx="48" cy="42" r="17" fill="#F2B33D" />
        <path d="M0 58c18-10 34-12 48-8s30 4 48-4v26H0z" fill="#4F8A5B" />
      </svg>
    );
  }
  if (id === 'steady') {
    return (
      <svg {...common}>
        <path
          className="steam"
          d="M40 10c-4 5 4 8 0 14M54 8c-4 5 4 8 0 14"
          stroke="#6E8F78"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M24 30h44v14c0 12-10 20-22 20S24 56 24 44z" fill="#2F6B4A" />
        <path d="M68 34h4a8 8 0 010 16h-6" stroke="#2F6B4A" strokeWidth="5" fill="none" />
        <rect x="14" y="64" width="64" height="5" rx="2.5" fill="#8FB59A" />
      </svg>
    );
  }
  if (id === 'tired') {
    return (
      <svg {...common}>
        <path d="M44 8a26 26 0 1 0 26 34A22 22 0 0 1 44 8z" fill="#3F5677" />
        <g fill="#B9C7DC">
          <circle className="twinkle" cx="76" cy="14" r="3" />
          <circle className="twinkle t2" cx="84" cy="30" r="2" />
          <circle className="twinkle t3" cx="66" cy="6" r="2" />
        </g>
        <path d="M54 62h30" stroke="#3F5677" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'uneasy') {
    return (
      <svg {...common}>
        <path
          className="wobble"
          d="M18 44c-8 0-12-6-12-11s5-11 12-11c2-9 9-14 18-14 8 0 14 4 17 11 2-1 5-2 8-2 9 0 15 6 15 14 0 7-6 13-14 13z"
          fill="#6B4A6E"
        />
        <g stroke="#9C7BA0" strokeWidth="4" strokeLinecap="round">
          <path className="drop" d="M28 54l-3 8" />
          <path className="drop d2" d="M44 54l-3 8" />
          <path className="drop d3" d="M60 54l-3 8" />
        </g>
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M10 50c0-12 9-20 20-20s21 8 21 19c0 9-9 15-21 15S10 60 10 50z" fill="#B65A4F" />
      <path
        className="lean"
        d="M44 44c0-10 8-17 18-17s18 7 18 16c0 8-8 14-18 14s-18-4-18-13z"
        fill="#E59A8E"
      />
      <path d="M44 14c-3-5-11-3-9 3 1 4 9 9 9 9s8-5 9-9c2-6-6-8-9-3z" fill="#B65A4F" />
    </svg>
  );
}
