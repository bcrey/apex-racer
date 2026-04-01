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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [speedMph, setSpeedMph] = useState(0);
  const [lap, setLap] = useState(1);
  const [lapTime, setLapTime] = useState(0);
  const [bestLap, setBestLap] = useState<number | null>(null);

  // --- Multiplayer State ---
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const myColorRef = useRef<string>('#06b6d4');
  const remotePlayers = useRef<Map<string, any>>(new Map());
  const lastSendTime = useRef<number>(0);

  const keys = useRef<{ [key: string]: boolean }>({});
  const car = useRef({
    x: 0, y: 0,
    vx: 0, vy: 0,
    angle: 0,
  });
  const skidMarks = useRef<{x: number, y: number, life: number}[]>([]);
  const gameState = useRef({
    nextCheckpoint: 0,
    lapStartTime: performance.now(),
  });

  useEffect(() => {
    // --- WebSocket Setup ---
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
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
          msg.players.forEach((p: any) => {
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
        } else if (msg.type === 'leave') {
          remotePlayers.current.delete(msg.id);
        }
      } catch (e) {
        console.error(e);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
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
      const isBraking = keys.current['arrowdown'] || keys.current['s'];
      const isTurningLeft = keys.current['arrowleft'] || keys.current['a'];
      const isTurningRight = keys.current['arrowright'] || keys.current['d'];

      const forwardX = Math.cos(c.angle);
      const forwardY = Math.sin(c.angle);
      const rightX = Math.cos(c.angle + Math.PI/2);
      const rightY = Math.sin(c.angle + Math.PI/2);

      const speed = c.vx * forwardX + c.vy * forwardY;
      const lateralSpeed = c.vx * rightX + c.vy * rightY;

      const dist = getDistanceToTrack(c);
      const isOnTrack = dist < 200;

      const engineForce = isOnTrack ? 0.6 : 0.3;
      const brakingForce = isOnTrack ? 0.8 : 0.4;
      const turnSpeed = 0.05;
      const drag = isOnTrack ? 0.97 : 0.90;
      const grip = isOnTrack ? 0.15 : 0.05;

      if (isAccelerating) {
        c.vx += forwardX * engineForce;
        c.vy += forwardY * engineForce;
      }
      if (isBraking) {
        c.vx -= forwardX * brakingForce;
        c.vy -= forwardY * brakingForce;
      }

      if (Math.abs(speed) > 0.5) {
        const turnDir = speed > 0 ? 1 : -1;
        if (isTurningLeft) c.angle -= turnSpeed * turnDir;
        if (isTurningRight) c.angle += turnSpeed * turnDir;
      }

      // Apply lateral friction (grip)
      c.vx -= rightX * lateralSpeed * grip;
      c.vy -= rightY * lateralSpeed * grip;

      // Apply drag
      c.vx *= drag;
      c.vy *= drag;

      c.x += c.vx;
      c.y += c.vy;

      // Skid marks
      if (Math.abs(lateralSpeed) > 3 && isOnTrack) {
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
        if (prevX < 0 && c.x >= 0 && Math.abs(c.y) < 200) {
          // Lap complete!
          const currentLapTime = time - state.lapStartTime;
          setBestLap(prev => prev === null ? currentLapTime : Math.min(prev, currentLapTime));
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
      ctx.lineWidth = 400;
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
      ctx.translate(trackPoints[0].x, trackPoints[0].y);
      const dx = trackPoints[1].x - trackPoints[0].x;
      const dy = trackPoints[1].y - trackPoints[0].y;
      ctx.rotate(Math.atan2(dy, dx));
      
      ctx.fillStyle = '#fff';
      ctx.fillRect(-10, -200, 20, 400);
      ctx.fillStyle = '#000';
      for (let i = -200; i < 200; i += 40) {
        ctx.fillRect(-10, i, 10, 20);
        ctx.fillRect(0, i + 20, 10, 20);
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
      });

      // Local Car
      drawCar(ctx, c.x, c.y, c.angle, myColorRef.current, true);

      ctx.restore();

      animationId = requestAnimationFrame(loop);
    };
    animationId = requestAnimationFrame(loop);

    return () => {
      if (wsRef.current) wsRef.current.close();
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((ms % 1000) / 10);
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
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
    </div>
  );
}
