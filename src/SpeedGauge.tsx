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
  };
});

function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

export default function SpeedGauge({ mph }: { mph: number }) {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white shadow-xl backdrop-blur-md sm:h-36 sm:w-36">
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
        {TICKS.map((tick) => {
          const lit = mph > 0 && tick.mph <= mph;
          const redZone = tick.mph >= REDLINE_MPH;
          return (
            <line
              key={tick.mph}
              stroke={lit ? tick.color : redZone ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.18)'}
              strokeLinecap="round"
              strokeWidth={tick.major ? 2.6 : 1.6}
              style={lit ? { filter: `drop-shadow(0 0 1.5px ${tick.color})` } : undefined}
              x1={tick.x1}
              x2={tick.x2}
              y1={tick.y1}
              y2={tick.y2}
            />
          );
        })}
      </svg>
      <div className="flex flex-col items-center">
        <span className="text-4xl font-black italic tabular-nums tracking-tighter sm:text-5xl">{mph}</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-rose-400 sm:text-xs">mph</span>
      </div>
    </div>
  );
}
