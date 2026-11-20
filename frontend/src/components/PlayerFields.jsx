import { GENDERS, PLAYING_CATEGORIES, SKILL_LEVELS } from '../utils/format';

/** Shared player profile inputs (register, admin create/edit). */
export default function PlayerFields({ form, set, disabled = {} }) {
  return (
    <>
      <label className="field span-2">
        <span>Full name</span>
        <input required minLength={2} maxLength={120} value={form.fullName} onChange={set('fullName')} disabled={disabled.fullName} />
      </label>
      <label className="field">
        <span>Gender</span>
        <select required value={form.gender} onChange={set('gender')} disabled={disabled.gender}>
          <option value="" disabled>Select…</option>
          {GENDERS.map((g) => <option key={g}>{g}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Age</span>
        <input type="number" required min={5} max={120} value={form.age} onChange={set('age')} disabled={disabled.age} />
      </label>
      <label className="field">
        <span>Skill level</span>
        <select required value={form.skillLevel} onChange={set('skillLevel')} disabled={disabled.skillLevel}>
          {SKILL_LEVELS.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Playing category</span>
        <select required value={form.playingCategory} onChange={set('playingCategory')} disabled={disabled.playingCategory}>
          {PLAYING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
    </>
  );
}
