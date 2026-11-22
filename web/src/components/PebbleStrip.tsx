import { MOOD_BY_LABEL } from '../copy';
import type { StoryDay } from '../types';
import { MoodArt } from './MoodBoard';
import { Pebble, statusWord } from './ui';

function shortDay(iso: string): { dow: string; date: string } {
  const d = new Date(iso);
  return {
    dow: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
    date: String(d.getDate()),
  };
}

/** A row of days as pebbles: filled = usual, clay = different, outlined = still learning. */
export function PebbleStrip({
  days,
  selected,
  onSelect,
  size = 44,
  label = 'Recent days',
}: {
  days: StoryDay[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  size?: number;
  label?: string;
}) {
  return (
    <ol className="strip" aria-label={label}>
      {days.map((day, index) => {
        const mood = day.moodLabel ? MOOD_BY_LABEL[day.moodLabel] : undefined;
        const { dow, date } = shortDay(day.at);
        const inner = (
          <>
            <Pebble status={day.status} size={size} seed={index}>
              {mood && <MoodArt id={mood} className="pebble-art" />}
            </Pebble>
            <span className="strip-dow">{dow}</span>
            <span className="strip-date">{date}</span>
          </>
        );
        const text = `${new Date(day.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${statusWord(day.status)}${day.moodLabel ? `, ${day.moodLabel}` : ''}`;
        return (
          <li key={day.id}>
            {onSelect ? (
              <button
                type="button"
                className="strip-day"
                aria-pressed={selected === day.id}
                aria-label={text}
                onClick={() => onSelect(day.id)}
              >
                {inner}
              </button>
            ) : (
              <span className="strip-day" aria-label={text} role="img">
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
