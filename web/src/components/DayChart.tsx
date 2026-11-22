import type { Band, StoryDay } from '../types';
import { whole } from '../format';

export function DayChart({ days, band }: { days: StoryDay[]; band: Band | null }) {
  const points = days.filter((day) => day.pulse !== null);
  if (points.length < 2) return null;
  const width = Math.max(320, points.length * 48);
  const height = 168;
  const padL = 36;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const values = points.map((day) => day.pulse as number);
  const lows = band ? [band.low, band.q1] : [];
  const highs = band ? [band.high, band.q3] : [];
  const rawMin = Math.min(...values, ...lows);
  const rawMax = Math.max(...values, ...highs);
  let min = rawMin - 2;
  let max = rawMax + 2;
  // A 6 bpm cluster should not fill the chart. Keep at least a 20 bpm window.
  if (max - min < 20) {
    const mid = (rawMin + rawMax) / 2;
    min = mid - 10;
    max = mid + 10;
  }
  const span = Math.max(1, max - min);
  const x = (index: number) =>
    padL + (index * (width - padL - padR)) / Math.max(1, points.length - 1);
  const y = (value: number) => padT + ((max - value) * (height - padT - padB)) / span;
  const fill =
    band && band.q3 > band.q1 ? { y: y(band.q3), h: Math.max(2, y(band.q1) - y(band.q3)) } : null;

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Pulse across recent check-ins"
      >
        {fill && (
          <rect
            x={padL}
            y={fill.y}
            width={width - padL - padR}
            height={fill.h}
            fill="var(--moss-soft)"
            rx="6"
          />
        )}
        <line
          x1={padL}
          y1={height - padB}
          x2={width - padR}
          y2={height - padB}
          stroke="var(--line)"
        />
        {points.map((day, index) => {
          const pulse = day.pulse as number;
          const color =
            day.status === 'different' || day.pulseState === 'outside'
              ? 'var(--clay)'
              : 'var(--moss)';
          return (
            <g key={day.id}>
              <circle cx={x(index)} cy={y(pulse)} r="6" fill={color} />
              <text x={x(index)} y={height - 8} textAnchor="middle">
                {new Date(day.at).getDate()}
              </text>
            </g>
          );
        })}
        <text x={padL - 6} y={y(max) + 4} textAnchor="end">
          {whole(max)}
        </text>
        <text x={padL - 6} y={y(min)} textAnchor="end">
          {whole(min)}
        </text>
      </svg>
      <p className="fine">
        Pulse per day. The green band is their usual middle. Clay dots fell outside it.
      </p>
    </div>
  );
}
