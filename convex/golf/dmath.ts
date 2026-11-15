const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const TWO_PI = 6.283185307179586;

export const hyp = (x: number, y: number) => Math.sqrt(x * x + y * y);

function sinCore(x: number) {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000 + x2 / 355687428096000))))))))
  );
}
function cosCore(x: number) {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 *
              (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 / 20922789888000)))))))
  );
}

function reduce(x: number): [number, number] {
  const q = Math.round(x / HALF_PI);
  const r = x - q * 1.5707963267341256 - q * 6.077100506506192e-11;
  return [((q % 4) + 4) % 4, r];
}

export function dsin(x: number) {
  const [q, r] = reduce(x);
  return q === 0 ? sinCore(r) : q === 1 ? cosCore(r) : q === 2 ? -sinCore(r) : -cosCore(r);
}
export function dcos(x: number) {
  const [q, r] = reduce(x);
  return q === 0 ? cosCore(r) : q === 1 ? -sinCore(r) : q === 2 ? -cosCore(r) : sinCore(r);
}

const SQRT3 = 1.7320508075688772;
const TAN_PI_12 = 0.2679491924311227;
function atanSmall(t: number) {
  const t2 = t * t;
  let s = 0;
  for (let k = 21; k >= 1; k -= 2) s = 1 / k - t2 * s;
  return t * s;
}
function atanUnit(t: number) {
  return t <= TAN_PI_12 ? atanSmall(t) : PI / 6 + atanSmall((t * SQRT3 - 1) / (t + SQRT3));
}
export function datan(t: number) {
  const a = Math.abs(t);
  const r = a <= 1 ? atanUnit(a) : HALF_PI - atanUnit(1 / a);
  return t < 0 ? -r : r;
}
export function datan2(y: number, x: number) {
  if (x === 0 && y === 0) return 0;
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  const a = datan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}

const LN2 = 0.6931471805599453;
export function dexp(x: number) {
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let s = 1,
    term = 1;
  for (let i = 1; i <= 18; i++) {
    term = (term * r) / i;
    s += term;
  }
  let p = 1;
  const b = k < 0 ? 0.5 : 2;
  for (let i = 0; i < Math.abs(k); i++) p *= b;
  return s * p;
}
export function dlog(x: number) {
  if (x <= 0) return -Infinity;
  let k = 0;
  while (x >= 1.4142135623730951) {
    x /= 2;
    k++;
  }
  while (x < 0.7071067811865476) {
    x *= 2;
    k--;
  }
  const u = (x - 1) / (x + 1),
    u2 = u * u;
  let s = 0;
  for (let n = 41; n >= 1; n -= 2) s = 1 / n + u2 * s;
  return 2 * u * s + k * LN2;
}
export const dacos = (x: number) => datan2(Math.sqrt(1 - x * x), x);
export const dpow = (x: number, e: number) => (x <= 0 ? 0 : dexp(e * dlog(x)));

export const DPI = PI;
export const DTWO_PI = TWO_PI;
