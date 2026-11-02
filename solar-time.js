// Approximate sun position from NOAA's fractional-year equations:
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF
// https://gml.noaa.gov/grad/solcalc/calcdetails.html
// All computation is local. Coordinates describe the general city position;
// neither device geolocation nor a remote solar/weather service is used.

const MINUTE = 60_000;
const DAY = 86_400_000;
const RAD = Math.PI / 180;
const FULL_TURN = Math.PI * 2;
const SUNRISE_ALTITUDE = -0.833 * RAD;

export const location = Object.freeze({
  name: 'Newcastle upon Tyne',
  latitude: 54.9783,
  longitude: -1.6178,
  timeZone: 'Europe/London',
  method: 'Approximate NOAA fractional-year solar equations',
  sunriseAltitude: SUNRISE_ALTITUDE,
});

const civilFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: location.timeZone,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: location.timeZone,
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const civilDays = new Map();
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const pad = value => String(value).padStart(2, '0');

function checkedDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('A valid Date or instant is required.');
  return date;
}

function civilParts(date) {
  const parts = {};
  for (const part of civilFormatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

function dateKey(parts) {
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`;
}

function wallSerial(date) {
  const parts = civilParts(date);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    + modulo(date.getTime(), 1000);
}

function offsetAt(timestamp) {
  return wallSerial(new Date(timestamp)) - timestamp;
}

function instantForWallTime(day, minutes) {
  const wanted = day.wallMidnight + Math.round(minutes * MINUTE);
  const candidates = day.offsets.map(offset => wanted - offset);
  const matches = candidates.filter(timestamp => wallSerial(new Date(timestamp)) === wanted);
  // The first occurrence is the deterministic choice in the repeated autumn hour.
  if (matches.length) return new Date(Math.min(...matches));

  // Missing spring wall times snap to the first valid instant after the gap.
  // This creates a monotonic plateau on a 24-hour wall-clock slider, rather than
  // moving backwards when its missing hour reaches the next real wall time.
  const earlier = candidates.filter(timestamp => wallSerial(new Date(timestamp)) < wanted);
  const later = candidates.filter(timestamp => wallSerial(new Date(timestamp)) > wanted);
  if (!earlier.length || !later.length) throw new RangeError('Unable to resolve this local civil time.');
  let low = Math.max(...earlier);
  let high = Math.min(...later);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (wallSerial(new Date(middle)) < wanted) low = middle;
    else high = middle;
  }
  return new Date(high);
}

function civilDay(parts) {
  const key = dateKey(parts);
  if (!civilDays.has(key)) {
    const wallMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
    const offsets = [...new Set([-1.5, 0, 1.5].map(days => offsetAt(wallMidnight + days * DAY)))];
    const day = { key, wallMidnight, offsets, events: null };
    day.start = instantForWallTime(day, 0);
    day.end = instantForWallTime(day, 1440);
    civilDays.set(key, day);
    if (civilDays.size > 64) civilDays.delete(civilDays.keys().next().value);
  }
  return civilDays.get(key);
}

/**
 * Select wall-clock minutes on now's Newcastle civil date, independent of the
 * computer's display timezone. 1440 means 00:00 on the next civil date, including
 * 23/25-hour DST days. Missing spring times snap to 02:00; duplicated autumn
 * times choose their earlier occurrence. Fractions are kept to millisecond
 * precision. Out-of-range minutes clamp to the 0–1440 slider interval.
 */
export function dateAtMinutes(minutes, now = new Date()) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) throw new RangeError('Minutes must be a finite number.');
  const day = civilDay(civilParts(checkedDate(now)));
  return instantForWallTime(day, clamp(value, 0, 1440));
}

function solarPosition(date) {
  const timestamp = date.getTime();
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const yearDays = (Date.UTC(year + 1, 0, 1) - yearStart) / DAY;
  const dayIndex = Math.floor((timestamp - yearStart) / DAY);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes()
    + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / MINUTE;
  const gamma = FULL_TURN / yearDays * (dayIndex + (utcMinutes / 60 - 12) / 24);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const hourAngle = (modulo(utcMinutes + equationOfTime + 4 * location.longitude, 1440) / 4 - 180) * RAD;
  const latitude = location.latitude * RAD;
  const altitude = Math.asin(clamp(Math.sin(latitude) * Math.sin(declination)
    + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle), -1, 1));
  const azimuth = modulo(Math.atan2(Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude)) + Math.PI, FULL_TURN);
  return { altitude, azimuth };
}

function crossing(low, high, rising) {
  while (high - low > 100) {
    const middle = Math.floor((low + high) / 2);
    const above = solarPosition(new Date(middle)).altitude >= SUNRISE_ALTITUDE;
    if (above === rising) high = middle;
    else low = middle;
  }
  return new Date(Math.round((low + high) / 2));
}

function solarEvents(day) {
  if (!day.events) {
    let sunrise = null, sunset = null;
    let previous = day.start.getTime();
    let above = solarPosition(day.start).altitude >= SUNRISE_ALTITUDE;
    const end = day.end.getTime();
    for (let current = Math.min(previous + 10 * MINUTE, end); previous < end;
      current = Math.min(current + 10 * MINUTE, end)) {
      const nextAbove = solarPosition(new Date(current)).altitude >= SUNRISE_ALTITUDE;
      if (!above && nextAbove) sunrise = crossing(previous, current, true);
      if (above && !nextAbove) sunset = crossing(previous, current, false);
      previous = current;
      above = nextAbove;
    }
    day.events = { sunrise, sunset };
  }
  return day.events;
}

function clockMinutes(date) {
  const parts = civilParts(date);
  return parts.hour * 60 + parts.minute + parts.second / 60 + date.getUTCMilliseconds() / MINUTE;
}

/**
 * Sun position is geometric solar-centre altitude in radians. Sunrise/sunset
 * use the conventional -0.833° centre threshold (solar radius + refraction);
 * refraction is not applied a second time to altitude. Azimuth is radians
 * clockwise from north: N=0, E=π/2, S=π, W=3π/2. Sunrise/sunset are approximate
 * local-day crossings, not terrain/weather-aware observations.
 */
export function getSolarState(value = new Date()) {
  const date = checkedDate(value);
  const parts = civilParts(date);
  const day = civilDay(parts);
  const { altitude, azimuth } = solarPosition(date);
  const events = solarEvents(day);
  const sunrise = events.sunrise && new Date(events.sunrise.getTime());
  const sunset = events.sunset && new Date(events.sunset.getTime());
  const isDay = altitude >= SUNRISE_ALTITUDE;
  const twilight = isDay ? 'day' : altitude >= -6 * RAD ? 'civil'
    : altitude >= -12 * RAD ? 'nautical' : altitude >= -18 * RAD ? 'astronomical' : 'night';
  return {
    date,
    minutes: clockMinutes(date),
    localDate: day.key,
    timeLabel: clockFormatter.format(date),
    altitude,
    azimuth,
    sunrise,
    sunset,
    sunriseMinutes: sunrise ? clockMinutes(sunrise) : null,
    sunsetMinutes: sunset ? clockMinutes(sunset) : null,
    sunriseLabel: sunrise ? clockFormatter.format(sunrise) : '—',
    sunsetLabel: sunset ? clockFormatter.format(sunset) : '—',
    isDay,
    twilight,
    civilDayMinutes: (day.end - day.start) / MINUTE,
  };
}
