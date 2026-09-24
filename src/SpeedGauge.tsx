import { memo } from 'react';
import { mixHex } from './color';

// V2 speedometer: a 270° dial of tick marks that light up as speed rises,
// with a red zone at the top end.

// Terminal velocity on track is about 19.4 units/frame, which reads as ~60 mph
const MAX_MPH = 60;
const TICK_STEP_MPH = 2;
const MAJOR_EVERY_MPH = 10;
const REDLINE_MPH = 50;
const START_DEG = 135;
const SWEEP_DEG = 270;

const TICKS = Array.from({ length: MAX_MPH / TICK_STEP_MPH + 1 }, (_, i) => {
  const mph = i * TICK_STEP_MPH;
  const angle = ((START_DEG + (mph / MAX_MPH) * SWEEP_DEG) * Math.PI) / 180;
  const major = mph % MAJOR_EVERY_MPH === 0;
  const outer = 46;
  const inner = major ? 36 : 40;
  return {
    mph,
    major,
    x1: 50 + Math.cos(angle) * inner,
    y1: 50 + Math.sin(angle) * inner,
    x2: 50 + Math.cos(angle) * outer,
    y2: 50 + Math.sin(angle) * outer,
    // Rose at rest through orange; the red zone is its own colour
    color: mph >= REDLINE_MPH ? '#ef4444' : mixHex('#fb7185', '#fb923c', mph / REDLINE_MPH),
    dim: mph >= REDLINE_MPH ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.18)',
  };
});

function SpeedGauge({ mph }: { mph: number }) {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white shadow-xl backdrop-blur-md sm:h-36 sm:w-36">
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
        {/* One glow filter on the lit group rather than one per tick */}
        <g>
          {TICKS.filter((tick) => mph === 0 || tick.mph > mph).map((tick) => (
            tickLine(tick, tick.dim)
          ))}
        </g>
        <g style={{ filter: 'drop-shadow(0 0 1.5px rgba(251, 146, 60, 0.8))' }}>
          {TICKS.filter((tick) => mph > 0 && tick.mph <= mph).map((tick) => (
            tickLine(tick, tick.color)
          ))}
        </g>
      </svg>
      <div className="flex flex-col items-center">
        <span className="text-4xl font-black italic tabular-nums tracking-tighter sm:text-5xl">{mph}</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-rose-400 sm:text-xs">mph</span>
      </div>
    </div>
  );
}

function tickLine(tick: (typeof TICKS)[number], stroke: string) {
  return (
    <line
      key={tick.mph}
      stroke={stroke}
      strokeLinecap="round"
      strokeWidth={tick.major ? 2.6 : 1.6}
      x1={tick.x1}
      x2={tick.x2}
      y1={tick.y1}
      y2={tick.y2}
    />
  );
}

// Speed is a whole number, so most frames it is unchanged and this skips work
export default memo(SpeedGauge);
