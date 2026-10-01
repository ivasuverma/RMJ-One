const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'Fri, 2 Oct' (adds the year when it isn't this year: 'Fri, 2 Oct 2027').
 * For calendar dates (due dates etc.), so no timezone shift. Anything else is returned as is. */
export function friendlyDate(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const sameYear = +m[1] === new Date().getFullYear();
  return `${WD[d.getUTCDay()]}, ${+m[3]} ${MO[+m[2] - 1]}${sameYear ? '' : ` ${m[1]}`}`;
}
