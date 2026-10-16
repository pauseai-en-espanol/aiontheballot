/**
 * A clip time as people write it (admin forms §2, cells; PLAN R196): seconds (`83`, `83.5`), minutes and seconds
 * (`1:23`, `1:23.5`) or hours too (`1:02:03`), to the millisecond as the database keeps them; none for anything else
 * (seconds or minutes past 59 after a colon, a negative time, letters).
 */
export const parseClipTime = (text: string): number | undefined => {
  const typed = text.trim().replace(',', '.');
  const match = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d{1,3})?)$/u.exec(typed);
  if (!match) {
    return undefined;
  }
  const [, hours, minutes, seconds] = match;
  const s = Number(seconds);
  const m = minutes === undefined ? 0 : Number(minutes);
  // After a colon, minutes and seconds are as a clock has them.
  if (minutes !== undefined && s >= 60) {
    return undefined;
  }
  if (hours !== undefined && m >= 60) {
    return undefined;
  }
  return Math.round(((hours === undefined ? 0 : Number(hours)) * 3600 + m * 60 + s) * 1000) / 1000;
};

/** A clip time as the field shows it: `m:ss`, `h:mm:ss` from an hour on, and its milliseconds if it has any. */
export const formatClipTime = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const millis = Math.round((seconds - whole) * 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const fraction = millis === 0 ? '' : `.${String(millis).padStart(3, '0').replace(/0+$/u, '')}`;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}${fraction}` : `${m}:${pad(s)}${fraction}`;
};
