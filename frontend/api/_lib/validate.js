import { ValidationError } from './http.js';

// Enum values in declaration order (the order matters for sorting and dashboard output).
export const Enums = {
  UserRole: ['Player', 'Admin'],
  Gender: ['Male', 'Female', 'Other'],
  SkillLevel: ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Pro'],
  PlayingCategory: ['Singles', 'Doubles', 'Both'],
  MatchFormat: ['Singles', 'Doubles'],
  MatchCategory: ['Open', 'Mens', 'Womens', 'Mixed'],
  MatchStatus: ['Scheduled', 'Completed', 'Cancelled'],
  LeaderboardScope: ['Overall', 'Singles', 'Doubles', 'Mens', 'Womens', 'MixedDoubles'],
};

/** Accepts an enum name (case-insensitive) or its numeric value, like ASP.NET does. */
export function parseEnum(values, raw) {
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim()))) {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < values.length ? values[n] : undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const lower = raw.trim().toLowerCase();
  return values.find((v) => v.toLowerCase() === lower);
}

const EMAIL = (s) => {
  const at = s.indexOf('@');
  return at > 0 && at !== s.length - 1 && at === s.lastIndexOf('@');
};

const pascal = (k) => k.charAt(0).toUpperCase() + k.slice(1);

/** Reads `key` from a JSON object case-insensitively. */
function pick(body, key) {
  if (key in body) return body[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(body)) if (k.toLowerCase() === lower) return body[k];
  return undefined;
}

function parseInt32(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : NaN;
  if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) return Number(raw);
  return NaN;
}

/** ISO date/time; values without a zone are treated as UTC (same as the original API). */
export function parseDate(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim();
  if (/T\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Validates a JSON body against a field spec and returns a clean object.
 * spec: { field: { type, required, min, max, minLength, maxLength, email, values, default, fields } }
 */
export function validate(body, spec, prefix = '', errors = null) {
  const root = errors === null;
  errors ??= {};
  const out = {};
  const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  const add = (key, msg) => {
    (errors[key] ??= []).push(msg);
  };

  for (const [key, rule] of Object.entries(spec)) {
    const name = pascal(key);
    const path = prefix + name;
    let v = pick(src, key);

    if (v === undefined || v === null) {
      if (rule.required) add(path, `The ${name} field is required.`);
      out[key] = rule.default ?? null;
      continue;
    }

    switch (rule.type) {
      case 'string': {
        if (typeof v !== 'string') {
          add(path, `The ${name} field must be a string.`);
          break;
        }
        if (rule.required && !v.trim()) {
          add(path, `The ${name} field is required.`);
          break;
        }
        if (rule.minLength !== undefined && rule.maxLength !== undefined) {
          if (v.length < rule.minLength || v.length > rule.maxLength)
            add(path, `The field ${name} must be a string with a minimum length of ${rule.minLength} and a maximum length of ${rule.maxLength}.`);
        } else if (rule.maxLength !== undefined && v.length > rule.maxLength) {
          add(path, `The field ${name} must be a string or array type with a maximum length of '${rule.maxLength}'.`);
        }
        if (rule.email && !EMAIL(v)) add(path, `The ${name} field is not a valid e-mail address.`);
        out[key] = v;
        break;
      }
      case 'int': {
        const n = parseInt32(v);
        if (Number.isNaN(n)) {
          add(path, `The ${name} field must be a whole number.`);
          break;
        }
        if (rule.min !== undefined && (n < rule.min || n > rule.max))
          add(path, `The field ${name} must be between ${rule.min} and ${rule.max}.`);
        out[key] = n;
        break;
      }
      case 'bool': {
        if (typeof v !== 'boolean') {
          add(path, `The ${name} field must be true or false.`);
          break;
        }
        out[key] = v;
        break;
      }
      case 'enum': {
        const e = parseEnum(rule.values, v);
        if (e === undefined) {
          add(path, `The value '${v}' is not valid for ${name}.`);
          break;
        }
        out[key] = e;
        break;
      }
      case 'date': {
        const d = parseDate(v);
        if (!d) {
          add(path, `The ${name} field must be a valid date and time.`);
          break;
        }
        out[key] = d;
        break;
      }
      case 'intArray': {
        if (!Array.isArray(v) || v.some((x) => Number.isNaN(parseInt32(x)))) {
          add(path, `The ${name} field must be a list of player ids.`);
          break;
        }
        const arr = v.map(parseInt32);
        if (rule.minLength !== undefined && arr.length < rule.minLength)
          add(path, `The field ${name} must be a string or array type with a minimum length of '${rule.minLength}'.`);
        if (rule.maxLength !== undefined && arr.length > rule.maxLength)
          add(path, `The field ${name} must be a string or array type with a maximum length of '${rule.maxLength}'.`);
        out[key] = arr;
        break;
      }
      case 'object': {
        if (typeof v !== 'object' || Array.isArray(v)) {
          add(path, `The ${name} field is invalid.`);
          break;
        }
        out[key] = validate(v, rule.fields, `${path}.`, errors);
        break;
      }
      default:
        throw new Error(`Unknown rule type ${rule.type}`);
    }
  }

  if (root && Object.keys(errors).length > 0) throw new ValidationError(errors);
  return out;
}

/** Parses query-string values; invalid values produce validation errors like ASP.NET model binding. */
export function readQuery(query, spec) {
  const errors = {};
  const out = {};
  for (const [key, rule] of Object.entries(spec)) {
    const raw = pick(query, key);
    if (raw === undefined || raw === '') {
      out[key] = rule.default ?? null;
      continue;
    }
    const name = key;
    switch (rule.type) {
      case 'int': {
        const n = parseInt32(raw);
        if (Number.isNaN(n)) errors[name] = [`The value '${raw}' is not valid.`];
        else out[key] = n;
        break;
      }
      case 'bool': {
        const l = raw.toLowerCase();
        if (l !== 'true' && l !== 'false') errors[name] = [`The value '${raw}' is not valid.`];
        else out[key] = l === 'true';
        break;
      }
      case 'enum': {
        const e = parseEnum(rule.values, raw);
        if (e === undefined) errors[name] = [`The value '${raw}' is not valid.`];
        else out[key] = e;
        break;
      }
      case 'date': {
        const d = parseDate(raw);
        if (!d) errors[name] = [`The value '${raw}' is not valid.`];
        else out[key] = d;
        break;
      }
      default:
        out[key] = raw;
    }
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return out;
}

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Shared request field specs.
export const profileFields = {
  fullName: { type: 'string', required: true, minLength: 2, maxLength: 120 },
  gender: { type: 'enum', values: Enums.Gender, required: true },
  age: { type: 'int', required: true, min: 5, max: 120 },
  skillLevel: { type: 'enum', values: Enums.SkillLevel, required: true },
  playingCategory: { type: 'enum', values: Enums.PlayingCategory, required: true },
};

export const emailField = { type: 'string', required: true, email: true, maxLength: 256 };
export const newPasswordField = { type: 'string', required: true, minLength: 8, maxLength: 128 };
