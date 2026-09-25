import { metresBetween, type LatLng, type Route, type RouteStep } from '@/lib/route';

/** How far you are along the route, what comes next, and whether you have left it. */
export type NavProgress = {
  /** Where you are on the line, [longitude, latitude]. */
  snapped: [number, number];
  /** Distance from you to the line. */
  offRouteM: number;
  remainingM: number;
  remainingS: number;
  /** The next manoeuvre, or null once only the arrival is left. */
  next: { step: RouteStep; inM: number; text: string; angle: number | null } | null;
  /** The line still to travel, from where you are. */
  ahead: [number, number][];
  arrived: boolean;
};

/** Within this of the person (plus some of the GPS uncertainty), you have arrived. */
const ARRIVED_M = 25;

type Measured = { cumulative: number[]; total: number; stepAt: number[] };

const cache = new WeakMap<Route, Measured>();

function project(p: LatLng, a: [number, number], b: [number, number]) {
  const kx = 111_320 * Math.cos(p.lat * (Math.PI / 180));
  const ky = 110_540;
  const ax = (a[0] - p.lng) * kx;
  const ay = (a[1] - p.lat) * ky;
  const bx = (b[0] - p.lng) * kx;
  const by = (b[1] - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return { t, dist: Math.hypot(ax + t * dx, ay + t * dy) };
}

/** Nearest point on the line to `p`, searched from segment `from` onwards: its segment, fraction and distance. */
function nearest(line: [number, number][], p: LatLng, from = 0) {
  let best = { seg: from, t: 0, dist: Infinity };
  for (let i = Math.max(0, from); i < line.length - 1; i++) {
    const { t, dist } = project(p, line[i], line[i + 1]);
    if (dist < best.dist) best = { seg: i, t, dist };
  }
  return best;
}

function measure(route: Route): Measured {
  const hit = cache.get(route);
  if (hit) return hit;
  const line = route.coordinates;
  const cumulative = [0];
  for (let i = 1; i < line.length; i++) {
    cumulative.push(cumulative[i - 1] + metresBetween({ lng: line[i - 1][0], lat: line[i - 1][1] }, { lng: line[i][0], lat: line[i][1] }));
  }
  const at = (seg: number, t: number) => cumulative[seg] + t * (cumulative[seg + 1] - cumulative[seg]);
  // Where along the line each manoeuvre is. Steps come in order, so each search starts where the last one ended.
  let from = 0;
  const stepAt = route.steps.map((s) => {
    const n = nearest(line, { lng: s.location[0], lat: s.location[1] }, from);
    from = n.seg;
    return at(n.seg, n.t);
  });
  const measured = { cumulative, total: cumulative[cumulative.length - 1] || 1, stepAt };
  cache.set(route, measured);
  return measured;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const TURNS: Record<string, { text: string; angle: number }> = {
  uturn: { text: 'Make a U-turn', angle: 180 },
  'sharp right': { text: 'Turn sharp right', angle: 135 },
  right: { text: 'Turn right', angle: 90 },
  'slight right': { text: 'Bear right', angle: 45 },
  straight: { text: 'Go straight on', angle: 0 },
  'slight left': { text: 'Bear left', angle: -45 },
  left: { text: 'Turn left', angle: -90 },
  'sharp left': { text: 'Turn sharp left', angle: -135 },
};

const side = (modifier: string | null) => (modifier?.includes('left') ? 'left' : modifier?.includes('right') ? 'right' : null);

/**
 * The spoken-style instruction for a step ("Turn left onto Jan Smuts Avenue") and the arrow angle to draw
 * (0 straight on, 90 right, -90 left; null for a roundabout or the arrival, which have their own symbols).
 */
export function describeStep(step: RouteStep, destination: string): { text: string; angle: number | null } {
  const onto = step.name ? ` onto ${step.name}` : '';
  const turn = TURNS[step.modifier ?? 'straight'] ?? TURNS.straight;
  switch (step.type) {
    case 'depart':
      return { text: `Head ${COMPASS[Math.round(step.bearingAfter / 45) % 8]}${step.name ? ` on ${step.name}` : ''}`, angle: 0 };
    case 'arrive':
      return { text: `Arrive at ${destination}`, angle: null };
    case 'roundabout':
    case 'rotary': {
      const exit = step.exit && step.exit <= ORDINALS.length ? ` take the ${ORDINALS[step.exit - 1]} exit` : ' take your exit';
      return { text: `At the roundabout,${exit}${onto}`, angle: null };
    }
    case 'exit roundabout':
    case 'exit rotary':
      return { text: `Leave the roundabout${onto}`, angle: turn.angle };
    case 'merge':
      return { text: `Merge${side(step.modifier) ? ` ${side(step.modifier)}` : ''}${onto}`, angle: turn.angle };
    case 'on ramp':
      return { text: `Take the ramp${side(step.modifier) ? ` on the ${side(step.modifier)}` : ''}${onto}`, angle: turn.angle };
    case 'off ramp':
      return { text: `Take the exit${side(step.modifier) ? ` on the ${side(step.modifier)}` : ''}${onto}`, angle: turn.angle };
    case 'fork':
      return { text: `Keep ${side(step.modifier) ?? 'straight'} at the fork${onto}`, angle: turn.angle };
    case 'new name':
    case 'continue':
      return step.modifier && step.modifier !== 'straight'
        ? { text: `${turn.text} to stay${step.name ? ` on ${step.name}` : ' on the road'}`, angle: turn.angle }
        : { text: `Continue${onto}`, angle: 0 };
    default: // turn, end of road, notification, use lane...
      return { text: `${turn.text}${onto}`, angle: turn.angle };
  }
}

/** "In 350 m", "In 1.2 km", "Now". */
export function formatIn(metres: number): string {
  if (metres < 15) return 'Now';
  if (metres < 1000) return `In ${metres < 100 ? Math.round(metres / 5) * 5 : Math.round(metres / 10) * 10} m`;
  return `In ${(metres / 1000).toFixed(1)} km`;
}

/** Where you are along a route. `accuracy` is the GPS uncertainty of your position, in metres. */
export function progressAlong(route: Route, me: LatLng, target: LatLng, destination: string, accuracy: number | null = null): NavProgress {
  const line = route.coordinates;
  const { cumulative, total, stepAt } = measure(route);
  const n = nearest(line, me);
  const a = line[n.seg];
  const b = line[n.seg + 1] ?? a;
  const snapped: [number, number] = [a[0] + n.t * (b[0] - a[0]), a[1] + n.t * (b[1] - a[1])];
  const along = cumulative[n.seg] + n.t * ((cumulative[n.seg + 1] ?? cumulative[n.seg]) - cumulative[n.seg]);
  const share = Math.max(0, 1 - along / total);

  const arrived = metresBetween(me, target) <= ARRIVED_M + Math.min(accuracy ?? 0, 25);
  let next: NavProgress['next'] = null;
  for (let i = 0; i < route.steps.length; i++) {
    const step = route.steps[i];
    if (step.type === 'depart' && along > 15) continue;
    if (stepAt[i] > along + 3 || (step.type === 'depart' && i === 0)) {
      const { text, angle } = describeStep(step, destination);
      next = { step, inM: Math.max(0, stepAt[i] - along), text, angle };
      break;
    }
  }

  return {
    snapped,
    offRouteM: n.dist,
    remainingM: route.distanceM * share,
    remainingS: route.durationS * share,
    next,
    ahead: [snapped, ...line.slice(n.seg + 1)],
    arrived,
  };
}

/** True when you are clearly off the line: further than 35 m, and further than the GPS could be wrong by. */
export function isOffRoute(progress: NavProgress, accuracy: number | null): boolean {
  return progress.offRouteM > Math.max(35, (accuracy ?? 0) * 1.5);
}
