import assert from 'node:assert/strict';
import { dateAtMinutes, getSolarState, location } from '../solar-time.js';

const RAD = Math.PI / 180;
const instant = value => new Date(value);
const isoAt = (minutes, reference) => dateAtMinutes(minutes, instant(reference)).toISOString();
const summer = getSolarState(instant('2026-06-21T12:00:00Z'));
const winter = getSolarState(instant('2026-12-21T12:00:00Z'));

// Independent broad seasonal expectations for Newcastle, plus consistency of
// the actual event crossings. Approximate solar math is not an almanac service.
assert.ok(summer.sunriseMinutes > 260 && summer.sunriseMinutes < 280);
assert.ok(summer.sunsetMinutes > 1290 && summer.sunsetMinutes < 1320);
assert.ok(winter.sunriseMinutes > 500 && winter.sunriseMinutes < 525);
assert.ok(winter.sunsetMinutes > 930 && winter.sunsetMinutes < 955);
assert.ok(summer.altitude / RAD > 57 && summer.altitude / RAD < 60);
assert.ok(winter.altitude / RAD > 10 && winter.altitude / RAD < 13);
assert.ok(summer.azimuth / RAD > 150 && summer.azimuth / RAD < 190);
assert.ok(summer.isDay && winter.isDay);
assert.equal(getSolarState(instant('2026-12-21T00:00:00Z')).isDay, false);
for (const state of [summer, winter]) {
  assert.equal(state.civilDayMinutes, 1440);
  assert.equal(getSolarState(state.sunrise).localDate, state.localDate);
  assert.equal(getSolarState(state.sunset).localDate, state.localDate);
  assert.ok(Math.abs(getSolarState(state.sunrise).altitude - location.sunriseAltitude) < 0.00002);
  assert.ok(Math.abs(getSolarState(state.sunset).altitude - location.sunriseAltitude) < 0.00002);
  assert.equal(getSolarState(new Date(state.sunrise.getTime() - 60_000)).isDay, false);
  assert.equal(getSolarState(new Date(state.sunrise.getTime() + 60_000)).isDay, true);
  assert.equal(getSolarState(new Date(state.sunset.getTime() - 60_000)).isDay, true);
  assert.equal(getSolarState(new Date(state.sunset.getTime() + 60_000)).isDay, false);
}

// Spring clock change: 01:00–01:59 do not exist. Missing times snap to02:00.
const spring = '2026-03-29T12:00:00Z';
assert.equal(isoAt(0, spring), '2026-03-29T00:00:00.000Z');
assert.equal(isoAt(59, spring), '2026-03-29T00:59:00.000Z');
assert.equal(isoAt(60, spring), '2026-03-29T01:00:00.000Z');
assert.equal(isoAt(90, spring), '2026-03-29T01:00:00.000Z');
assert.equal(isoAt(120, spring), '2026-03-29T01:00:00.000Z');
assert.equal(isoAt(720, spring), '2026-03-29T11:00:00.000Z');
assert.equal(isoAt(1440, spring), '2026-03-29T23:00:00.000Z');
assert.equal(getSolarState(instant(spring)).civilDayMinutes, 1380);

// Autumn clock change: choose the earlier (BST) occurrence of a repeated time.
const autumn = '2026-10-25T12:00:00Z';
assert.equal(isoAt(0, autumn), '2026-10-24T23:00:00.000Z');
assert.equal(isoAt(90, autumn), '2026-10-25T00:30:00.000Z');
assert.equal(isoAt(120, autumn), '2026-10-25T02:00:00.000Z');
assert.equal(isoAt(720, autumn), '2026-10-25T12:00:00.000Z');
assert.equal(isoAt(1440, autumn), '2026-10-26T00:00:00.000Z');
assert.equal(getSolarState(instant(autumn)).civilDayMinutes, 1500);
const first130 = getSolarState(instant('2026-10-25T00:30:00Z'));
const second130 = getSolarState(instant('2026-10-25T01:30:00Z'));
assert.equal(first130.timeLabel, '01:30');
assert.equal(second130.timeLabel, '01:30');
assert.equal(first130.minutes, 90);
assert.equal(second130.minutes, 90);
assert.notEqual(first130.altitude, second130.altitude);

// Manual minutes never move backwards, including both unusual civil days.
for (const reference of [spring, autumn, '2026-06-21T12:00:00Z']) {
  let previous = -Infinity;
  for (let minute = 0; minute <= 1440; minute += 15) {
    const next = dateAtMinutes(minute, instant(reference)).getTime();
    assert.ok(next >= previous);
    previous = next;
  }
}

// Civil date comes from Newcastle, not UTC or the execution host's timezone.
assert.equal(isoAt(720, '2026-06-21T23:30:00Z'), '2026-06-22T11:00:00.000Z');
assert.equal(isoAt(0, '2026-06-21T23:30:00Z'), '2026-06-21T23:00:00.000Z');
assert.equal(isoAt(1440, '2026-12-31T12:00:00Z'), '2027-01-01T00:00:00.000Z');
assert.equal(getSolarState(dateAtMinutes(1440, instant('2026-12-31T12:00:00Z'))).localDate, '2027-01-01');
assert.equal(getSolarState(dateAtMinutes(1440, instant('2026-12-31T12:00:00Z'))).minutes, 0);
assert.equal(isoAt(-20, spring), isoAt(0, spring));
assert.equal(isoAt(1500, spring), isoAt(1440, spring));
assert.equal(dateAtMinutes(720.5, instant(spring)).toISOString(), '2026-03-29T11:00:30.000Z');
assert.throws(() => dateAtMinutes(NaN), RangeError);
assert.throws(() => getSolarState(new Date(NaN)), RangeError);

console.log(JSON.stringify({
  location: location.name,
  summer: { sunrise: summer.sunriseLabel, sunset: summer.sunsetLabel, altitudeDegrees: summer.altitude / RAD },
  winter: { sunrise: winter.sunriseLabel, sunset: winter.sunsetLabel, altitudeDegrees: winter.altitude / RAD },
  checked: ['solstices', 'sunrise/sunset crossings', 'both2026UKDSTdays', 'monotonic manual time', 'live repeated hour', 'Newcastle civil date', '24:00/year rollover', 'fractional/clamped/invalid input'],
}));
