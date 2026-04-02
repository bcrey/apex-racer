import React, { useEffect, useRef, useState } from 'react';

// --- Math & Physics Helpers ---
function sqr(x: number) { return x * x; }
function dist2(v: {x: number, y: number}, w: {x: number, y: number}) { return sqr(v.x - w.x) + sqr(v.y - w.y); }
function distToSegmentSquared(p: {x: number, y: number}, v: {x: number, y: number}, w: {x: number, y: number}) {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

// Track waypoints
const trackPoints = [
  {x: 0, y: 0},
  {x: 1500, y: 0},
  {x: 2000, y: 500},
  {x: 2000, y: 1500},
  {x: 1000, y: 1500},
  {x: 500, y: 2000},
  {x: 500, y: 2500},
  {x: 1500, y: 2500},
  {x: 2000, y: 3000},
  {x: 2000, y: 4000},
  {x: 0, y: 4000},
  {x: -1000, y: 3000},
  {x: -1000, y: 1000},
  {x: -500, y: 500},
  {x: 0, y: 0}
];

// Anti-cheat checkpoints
const checkpoints = [
  {x: 2000, y: 1500},
  {x: 1500, y: 2500},
  {x: -1000, y: 1000}
];

const TRACK_WIDTH = 400;
const HALF_TRACK_WIDTH = TRACK_WIDTH / 2;
const START_FINISH_LINE_WIDTH = 20;
const START_FINISH_X = 900;
const START_FINISH_Y = 0;
const STARTING_GRID_OFFSET = 140;
const DEFAULT_START_X = START_FINISH_X - STARTING_GRID_OFFSET;
const DEFAULT_START_Y = -80;

type RemotePlayer = {
  id: string;
  initials: string;
  color: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
};

type LeaderboardEntry = {
  initials: string;
  timeMs: number;
};

function getDistanceToTrack(p: {x: number, y: number}) {
  let minDistSq = Infinity;
  for (let i = 0; i < trackPoints.length - 1; i++) {
    const d2 = distToSegmentSquared(p, trackPoints[i], trackPoints[i+1]);
    if (d2 < minDistSq) minDistSq = d2;
  }
  return Math.sqrt(minDistSq);
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, isLocal: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(-24, -14, 48, 28, 6);
  ctx.fill();

  // Tires
  ctx.fillStyle = '#020617'; // Very dark slate
  ctx.beginPath();
  ctx.roundRect(10, -13, 12, 4, 1); // Front Left
  ctx.roundRect(10, 9, 12, 4, 1);  // Front Right
  ctx.roundRect(-16, -13, 12, 4, 1); // Rear Left
  ctx.roundRect(-16, 9, 12, 4, 1);  // Rear Right
  ctx.fill();

  // Main Body Base (Widebody)
  ctx.fillStyle = '#1e293b'; // Slate 800
  ctx.beginPath();
  ctx.roundRect(-22, -11, 44, 22, 5);
  ctx.fill();

  // Center Body
  ctx.fillStyle = '#0f172a'; // Slate 900
  ctx.beginPath();
  ctx.roundRect(-20, -9, 42, 18, 4);
  ctx.fill();

  // Racing Stripes
  ctx.fillStyle = color;
  ctx.fillRect(-18, -3, 38, 2);
  ctx.fillRect(-18, 1, 38, 2);

  // Cockpit Roof
  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(-8, -7, 18, 14, 4);
  ctx.fill();

  // Windows
  ctx.fillStyle = '#38bdf8'; // Sky 400
  ctx.globalAlpha = 0.7;
  // Windshield
  ctx.beginPath();
  ctx.moveTo(4, -6);
  ctx.lineTo(11, -5);
  ctx.lineTo(11, 5);
  ctx.lineTo(4, 6);
  ctx.fill();
  // Rear Window
  ctx.beginPath();
  ctx.moveTo(-5, -5);
  ctx.lineTo(-9, -4);
  ctx.lineTo(-9, 4);
  ctx.lineTo(-5, 5);
  ctx.fill();
  // Side Windows
  ctx.fillRect(-3, -6.5, 6, 2);
  ctx.fillRect(-3, 4.5, 6, 2);
  ctx.globalAlpha = 1.0;

  // Spoiler
  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(-24, -10, 5, 20, 2);
  ctx.fill();
  // Spoiler Mounts
  ctx.fillStyle = '#334155';
  ctx.fillRect(-20, -6, 3, 2);
  ctx.fillRect(-20, 4, 3, 2);

  // Headlights
  ctx.fillStyle = '#cffafe'; // Cyan 100
  ctx.beginPath();
  ctx.moveTo(19, -9);
  ctx.lineTo(22, -7);
  ctx.lineTo(22, -4);
  ctx.lineTo(19, -4);
  ctx.fill();
  
  ctx.beginPath();
  ctx.moveTo(19, 9);
  ctx.lineTo(22, 7);
  ctx.lineTo(22, 4);
  ctx.lineTo(19, 4);
  ctx.fill();

  // Taillights
  ctx.fillStyle = '#ef4444'; // Red 500
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 8;
  ctx.fillRect(-22, -9, 2, 5);
  ctx.fillRect(-22, 4, 2, 5);
  ctx.shadowBlur = 0;

  if (isLocal) {
    // Headlight Beams
    const beamGrad = ctx.createLinearGradient(22, 0, 150, 0);
    beamGrad.addColorStop(0, 'rgba(207, 250, 254, 0.4)'); // Cyan 100 with opacity
    beamGrad.addColorStop(1, 'rgba(207, 250, 254, 0)');
    ctx.fillStyle = beamGrad;
    
    ctx.beginPath();
    ctx.moveTo(22, -7);
    ctx.lineTo(150, -35);
    ctx.lineTo(150, -5);
    ctx.lineTo(22, -4);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(22, 7);
    ctx.lineTo(150, 35);
    ctx.lineTo(150, 5);
    ctx.lineTo(22, 4);
    ctx.fill();
  }

  ctx.restore();
}

function drawDriverTag(ctx: CanvasRenderingContext2D, x: number, y: number, initials: string, color: string) {
  ctx.save();
  ctx.translate(x, y - 44);
  ctx.font = '700 14px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textWidth = ctx.measureText(initials).width;
  const tagWidth = Math.max(42, textWidth + 20);
  const tagHeight = 24;
  const pointerHeight = 8;
  const tagTop = -tagHeight - pointerHeight;

  ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-tagWidth / 2, tagTop, tagWidth, tagHeight, 12);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-7, -pointerHeight);
  ctx.lineTo(0, 0);
  ctx.lineTo(7, -pointerHeight);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.fillText(initials, 0, tagTop + tagHeight / 2);
  ctx.restore();
}

function sanitizeInitials(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
}

async function fetchLeaderboard() {
  const response = await fetch('/api/leaderboard');
  if (!response.ok) {
    throw new Error('Unable to load leaderboard');
  }

  const data = await response.json() as { entries?: LeaderboardEntry[] };
  return data.entries ?? [];
}

async function submitLapTime(initials: string, timeMs: number) {
  const response = await fetch('/api/leaderboard', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initials, timeMs }),
  });

  if (!response.ok) {
    throw new Error('Unable to save lap time');
  }

  const data = await response.json() as { entries?: LeaderboardEntry[] };
  return data.entries ?? [];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [speedMph, setSpeedMph] = useState(0);
  const [lap, setLap] = useState(1);
  const [lapTime, setLapTime] = useState(0);
  const [bestLap, setBestLap] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [playerInitials, setPlayerInitials] = useState('');
  const [initialsInput, setInitialsInput] = useState('');

  // --- Multiplayer State ---
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const myColorRef = useRef<string>('#06b6d4');
  const remotePlayers = useRef<Map<string, RemotePlayer>>(new Map());
  const lastSendTime = useRef<number>(0);

  const keys = useRef<{ [key: string]: boolean }>({});
  const car = useRef({
    x: DEFAULT_START_X, y: DEFAULT_START_Y,
    vx: 0, vy: 0,
    angle: 0,
  });
  const skidMarks = useRef<{x: number, y: number, life: number}[]>([]);
  const gameState = useRef({
    nextCheckpoint: 0,
    lapStartTime: performance.now(),
  });

  useEffect(() => {
    if (!playerInitials) {
      return;
    }

    let cancelled = false;

    const loadLeaderboard = async () => {
      try {
        setLeaderboardStatus('loading');
        const entries = await fetchLeaderboard();
        if (!cancelled) {
          setLeaderboard(entries);
          setLeaderboardStatus('ready');
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setLeaderboardStatus('error');
        }
      }
    };

    const saveLapTime = async (timeMs: number) => {
      try {
        const entries = await submitLapTime(playerInitials, timeMs);
        if (!cancelled) {
          setLeaderboard(entries);
          setLeaderboardStatus('ready');
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setLeaderboardStatus('error');
        }
      }
    };

    void loadLeaderboard();

    car.current.x = DEFAULT_START_X;
    car.current.y = DEFAULT_START_Y;
    car.current.vx = 0;
    car.current.vy = 0;
    car.current.angle = 0;
    myColorRef.current = '#06b6d4';
    myIdRef.current = 'local';
    remotePlayers.current.clear();

    // --- WebSocket Setup ---
    const shouldUseRealtimeServer = !window.location.hostname.endsWith('.vercel.app');
    if (shouldUseRealtimeServer) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}?initials=${encodeURIComponent(playerInitials)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'init') {
            myIdRef.current = msg.id;
            myColorRef.current = msg.color;
            car.current.x = msg.x;
            car.current.y = msg.y;
            remotePlayers.current.clear();
            msg.players.forEach((p: RemotePlayer) => {
              if (p.id !== msg.id) remotePlayers.current.set(p.id, p);
            });
          } else if (msg.type === 'join') {
            remotePlayers.current.set(msg.player.id, msg.player);
          } else if (msg.type === 'update') {
            const p = remotePlayers.current.get(msg.id);
            if (p) {
              p.x = msg.x;
              p.y = msg.y;
              p.angle = msg.angle;
              p.vx = msg.vx;
              p.vy = msg.vy;
            }
          } else if (msg.type === 'leaderboard') {
            setLeaderboard(msg.entries ?? []);
            setLeaderboardStatus('ready');
          } else if (msg.type === 'leave') {
            remotePlayers.current.delete(msg.id);
          }
        } catch (e) {
          console.error(e);
        }
      };
    } else {
      wsRef.current = null;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = true;
      if (e.code === 'Space') keys.current.space = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
      if (e.code === 'Space') keys.current.space = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    let animationId: number;
    let cameraX = canvas.width / 2;
    let cameraY = canvas.height / 2;

    const loop = (time: number) => {
      const c = car.current;
      const state = gameState.current;
      const prevX = c.x;

      // --- Physics ---
      const isAccelerating = keys.current['arrowup'] || keys.current['w'];
      const isBraking = keys.current['arrowdown'] || keys.current['s'] || keys.current.space;
      const isTurningLeft = keys.current['arrowleft'] || keys.current['a'];
      const isTurningRight = keys.current['arrowright'] || keys.current['d'];
      const steerInput = (isTurningRight ? 1 : 0) - (isTurningLeft ? 1 : 0);

      const forwardX = Math.cos(c.angle);
      const forwardY = Math.sin(c.angle);
      const rightX = Math.cos(c.angle + Math.PI/2);
      const rightY = Math.sin(c.angle + Math.PI/2);

      const speed = c.vx * forwardX + c.vy * forwardY;
      const lateralSpeed = c.vx * rightX + c.vy * rightY;

      const dist = getDistanceToTrack(c);
      const isOnTrack = dist < HALF_TRACK_WIDTH;
      const isDrifting = isOnTrack && isBraking && steerInput !== 0 && Math.abs(speed) > 2.5;

      const engineForce = isOnTrack ? 0.6 : 0.3;
      const brakingForce = isOnTrack ? (isDrifting ? 0.22 : 0.8) : 0.4;
      const turnSpeed = isDrifting ? 0.072 : 0.05;
      const drag = isOnTrack ? (isDrifting ? 0.985 : 0.97) : 0.90;
      const grip = isOnTrack ? (isDrifting ? 0.045 : 0.15) : 0.05;

      if (isAccelerating) {
        c.vx += forwardX * engineForce;
        c.vy += forwardY * engineForce;
      }
      if (isBraking) {
        const brakeAmount = Math.min(Math.abs(speed), brakingForce);
        const brakeDirection = speed === 0 ? 0 : Math.sign(speed);
        c.vx -= forwardX * brakeAmount * brakeDirection;
        c.vy -= forwardY * brakeAmount * brakeDirection;
      }

      if (Math.abs(speed) > 0.5) {
        const turnDir = speed > 0 ? 1 : -1;
        if (isTurningLeft) c.angle -= turnSpeed * turnDir;
        if (isTurningRight) c.angle += turnSpeed * turnDir;
      }

      if (isDrifting) {
        const driftPush = Math.min(Math.abs(speed) * 0.03, 0.75);
        c.vx += rightX * steerInput * driftPush;
        c.vy += rightY * steerInput * driftPush;
      }

      // Apply lateral friction (grip)
      c.vx -= rightX * lateralSpeed * grip;
      c.vy -= rightY * lateralSpeed * grip;

      // Apply drag
      c.vx *= drag;
      c.vy *= drag;

      // Remove any backward motion so brake input acts like a drift brake, not reverse.
      const nextForwardSpeed = c.vx * forwardX + c.vy * forwardY;
      if (nextForwardSpeed < 0) {
        c.vx -= forwardX * nextForwardSpeed;
        c.vy -= forwardY * nextForwardSpeed;
      }

      c.x += c.vx;
      c.y += c.vy;

      // Skid marks
      if (Math.abs(lateralSpeed) > (isDrifting ? 1.5 : 3) && isOnTrack) {
        skidMarks.current.push({
          x: c.x + rightX * -11 - forwardX * 16,
          y: c.y + rightY * -11 - forwardY * 16,
          life: 1.0
        });
        skidMarks.current.push({
          x: c.x + rightX * 11 - forwardX * 16,
          y: c.y + rightY * 11 - forwardY * 16,
          life: 1.0
        });
      }

      for (let i = skidMarks.current.length - 1; i >= 0; i--) {
        skidMarks.current[i].life -= 0.02;
        if (skidMarks.current[i].life <= 0) {
          skidMarks.current.splice(i, 1);
        }
      }

      // --- Multiplayer Send ---
      if (wsRef.current?.readyState === WebSocket.OPEN && time - lastSendTime.current > 50) {
        wsRef.current.send(JSON.stringify({
          type: 'update',
          x: c.x, y: c.y, angle: c.angle, vx: c.vx, vy: c.vy
        }));
        lastSendTime.current = time;
      }

      // --- Dead Reckoning for Remote Players ---
      remotePlayers.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
      });

      // --- Game Logic ---
      if (state.nextCheckpoint < checkpoints.length) {
        const cp = checkpoints[state.nextCheckpoint];
        if (dist2(c, cp) < 400 * 400) {
          state.nextCheckpoint++;
        }
      } else {
        if (
          prevX < START_FINISH_X &&
          c.x >= START_FINISH_X &&
          Math.abs(c.y - START_FINISH_Y) < HALF_TRACK_WIDTH
        ) {
          // Lap complete!
          const currentLapTime = time - state.lapStartTime;
          setBestLap(prev => prev === null ? currentLapTime : Math.min(prev, currentLapTime));
          void saveLapTime(currentLapTime);
          setLap(l => l + 1);
          state.nextCheckpoint = 0;
          state.lapStartTime = time;
        }
      }

      // Update UI
      setSpeedMph(Math.abs(Math.round(speed * 3.1)));
      setLapTime(time - state.lapStartTime);

      // --- Camera ---
      const targetCameraX = canvas.width / 2 - (c.x + c.vx * 15);
      const targetCameraY = canvas.height / 2 - (c.y + c.vy * 15);
      cameraX += (targetCameraX - cameraX) * 0.1;
      cameraY += (targetCameraY - cameraY) * 0.1;

      // --- Rendering ---
      ctx.fillStyle = '#166534'; // Grass
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(cameraX, cameraY);

      // Grass details
      ctx.fillStyle = '#14532d';
      const dotSpacing = 150;
      const startX = Math.floor(-cameraX / dotSpacing) * dotSpacing;
      const startY = Math.floor(-cameraY / dotSpacing) * dotSpacing;
      const endX = startX + canvas.width + dotSpacing;
      const endY = startY + canvas.height + dotSpacing;

      for (let x = startX; x < endX; x += dotSpacing) {
        for (let y = startY; y < endY; y += dotSpacing) {
          const offsetX = (Math.sin(x * 12.345 + y * 67.89) * 40);
          const offsetY = (Math.cos(x * 98.76 + y * 54.321) * 40);
          ctx.beginPath();
          ctx.arc(x + offsetX, y + offsetY, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Track
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(trackPoints[0].x, trackPoints[0].y);
      for (let i = 1; i < trackPoints.length; i++) {
        ctx.lineTo(trackPoints[i].x, trackPoints[i].y);
      }
      ctx.lineWidth = TRACK_WIDTH;
      ctx.strokeStyle = '#333';
      ctx.stroke();

      // Center line
      ctx.beginPath();
      ctx.moveTo(trackPoints[0].x, trackPoints[0].y);
      for (let i = 1; i < trackPoints.length; i++) {
        ctx.lineTo(trackPoints[i].x, trackPoints[i].y);
      }
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.setLineDash([40, 40]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Start/Finish line
      ctx.save();
      ctx.translate(START_FINISH_X, START_FINISH_Y);
      const dx = trackPoints[1].x - trackPoints[0].x;
      const dy = trackPoints[1].y - trackPoints[0].y;
      const startFinishHalfHeight = HALF_TRACK_WIDTH;
      const startFinishTop = -startFinishHalfHeight;
      const startFinishHeight = startFinishHalfHeight * 2;
      ctx.rotate(Math.atan2(dy, dx));
      
      ctx.fillStyle = '#fff';
      ctx.fillRect(-START_FINISH_LINE_WIDTH / 2, startFinishTop, START_FINISH_LINE_WIDTH, startFinishHeight);
      ctx.fillStyle = '#000';
      for (let i = startFinishTop; i < startFinishHalfHeight; i += 40) {
        ctx.fillRect(-START_FINISH_LINE_WIDTH / 2, i, START_FINISH_LINE_WIDTH / 2, 20);
        ctx.fillRect(0, i + 20, START_FINISH_LINE_WIDTH / 2, 20);
      }
      ctx.restore();

      // Skid marks
      skidMarks.current.forEach(mark => {
        ctx.fillStyle = `rgba(0, 0, 0, ${mark.life * 0.4})`;
        ctx.beginPath();
        ctx.arc(mark.x, mark.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Remote Cars
      remotePlayers.current.forEach(p => {
        drawCar(ctx, p.x, p.y, p.angle, p.color, false);
        drawDriverTag(ctx, p.x, p.y, p.initials, p.color);
      });

      // Local Car
      drawCar(ctx, c.x, c.y, c.angle, myColorRef.current, true);

      ctx.restore();

      animationId = requestAnimationFrame(loop);
    };
    animationId = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      if (wsRef.current) wsRef.current.close();
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [playerInitials]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((ms % 1000) / 10);
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
  };

  const handleJoin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextInitials = sanitizeInitials(initialsInput);
    if (nextInitials.length === 0) {
      return;
    }

    setPlayerInitials(nextInitials);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-green-900 font-sans">
      <canvas ref={canvasRef} className="block w-full h-full" />
      
      {/* HUD */}
      <div className="absolute top-6 left-6 bg-black/60 text-white p-5 rounded-2xl backdrop-blur-md border border-white/10 shadow-xl pointer-events-none">
        <h1 className="text-2xl font-black mb-1 text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400 italic tracking-wider">
          APEX RACER
        </h1>
        <p className="text-sm text-gray-300 font-medium mb-4">WASD or Arrows to drive</p>
        
        <div className="space-y-2 font-mono">
          <div className="flex justify-between items-center gap-6">
            <span className="text-gray-400 uppercase text-xs tracking-widest">Lap</span>
            <span className="text-xl font-bold">{lap}</span>
          </div>
          <div className="flex justify-between items-center gap-6">
            <span className="text-gray-400 uppercase text-xs tracking-widest">Time</span>
            <span className="text-xl font-bold text-yellow-400">{formatTime(lapTime)}</span>
          </div>
          {bestLap !== null && (
            <div className="flex justify-between items-center gap-6">
              <span className="text-gray-400 uppercase text-xs tracking-widest">Best</span>
              <span className="text-lg font-bold text-green-400">{formatTime(bestLap)}</span>
            </div>
          )}
          <div className="pt-3 mt-3 border-t border-white/10">
            <div className="text-gray-400 uppercase text-xs tracking-widest mb-2">Top 3 Fastest</div>
            <div className="space-y-2">
              {[0, 1, 2].map((index) => {
                const entry = leaderboard[index];
                return (
                  <div key={index} className="flex justify-between items-center gap-6 text-sm">
                    <span className="text-white/80">
                      {`#${index + 1} `}
                      <span className="font-bold">{entry?.initials ?? '---'}</span>
                    </span>
                    <span className={entry ? 'font-bold text-cyan-100' : 'text-white/30'}>
                      {entry ? formatTime(entry.timeMs) : '--:--.--'}
                    </span>
                  </div>
                );
              })}
            </div>
            {leaderboardStatus === 'error' && (
              <p className="mt-2 text-xs text-rose-300">Leaderboard unavailable</p>
            )}
          </div>
        </div>
      </div>

      <div className="absolute top-6 right-6 bg-black/60 text-white p-6 rounded-3xl backdrop-blur-md border border-white/10 shadow-xl flex flex-col items-end pointer-events-none">
        <div className="text-5xl font-black italic tracking-tighter">
          {speedMph}
        </div>
        <div className="text-rose-400 font-bold tracking-widest text-sm uppercase mt-1">
          mph
        </div>
      </div>

      {/* On-screen Controls */}
      <div className="absolute bottom-8 left-8 flex gap-4">
        <button 
          className="w-16 h-16 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white active:bg-white/30 select-none touch-none"
          onPointerDown={(e) => { e.preventDefault(); keys.current['arrowleft'] = true; }}
          onPointerUp={(e) => { e.preventDefault(); keys.current['arrowleft'] = false; }}
          onPointerLeave={(e) => { e.preventDefault(); keys.current['arrowleft'] = false; }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button 
          className="w-16 h-16 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white active:bg-white/30 select-none touch-none"
          onPointerDown={(e) => { e.preventDefault(); keys.current['arrowright'] = true; }}
          onPointerUp={(e) => { e.preventDefault(); keys.current['arrowright'] = false; }}
          onPointerLeave={(e) => { e.preventDefault(); keys.current['arrowright'] = false; }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>

      <div className="absolute bottom-8 right-8 flex gap-4 items-end">
        <button 
          className="w-16 h-16 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white active:bg-white/30 select-none touch-none mb-2"
          onPointerDown={(e) => { e.preventDefault(); keys.current['arrowdown'] = true; }}
          onPointerUp={(e) => { e.preventDefault(); keys.current['arrowdown'] = false; }}
          onPointerLeave={(e) => { e.preventDefault(); keys.current['arrowdown'] = false; }}
        >
          <span className="font-bold text-xs uppercase tracking-wider">Brake</span>
        </button>
        <button 
          className="w-20 h-20 bg-rose-500/80 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white active:bg-rose-400 select-none touch-none"
          onPointerDown={(e) => { e.preventDefault(); keys.current['arrowup'] = true; }}
          onPointerUp={(e) => { e.preventDefault(); keys.current['arrowup'] = false; }}
          onPointerLeave={(e) => { e.preventDefault(); keys.current['arrowup'] = false; }}
        >
          <span className="font-bold text-sm uppercase tracking-wider">Gas</span>
        </button>
      </div>

      {!playerInitials && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm px-6">
          <form
            onSubmit={handleJoin}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-black/70 p-7 text-white shadow-2xl"
          >
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-rose-300">Join Race</p>
            <h2 className="mt-3 text-3xl font-black italic tracking-tight text-white">Enter Your Initials</h2>
            <p className="mt-3 text-sm text-slate-300">
              Pick up to 3 letters so other drivers can see who is on the track.
            </p>

            <input
              autoFocus
              autoCapitalize="characters"
              className="mt-6 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-center text-3xl font-black uppercase tracking-[0.45em] text-cyan-100 outline-none transition focus:border-cyan-400"
              maxLength={3}
              onChange={(event) => setInitialsInput(sanitizeInitials(event.target.value))}
              placeholder="ABC"
              spellCheck={false}
              value={initialsInput}
            />

            <button
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-rose-500 to-orange-400 px-4 py-3 text-sm font-black uppercase tracking-[0.3em] text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={initialsInput.length === 0}
              type="submit"
            >
              Start Engines
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
