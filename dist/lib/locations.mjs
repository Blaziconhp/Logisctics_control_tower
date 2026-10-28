const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam",
  "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
  "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

const STATE_ALIASES = new Map(Object.entries({
  "andaman nicobar": "Andaman and Nicobar Islands", ap: "Andhra Pradesh",
  "arunachal pradesh": "Arunachal Pradesh", as: "Assam", br: "Bihar",
  cg: "Chhattisgarh", chattisgarh: "Chhattisgarh", dl: "Delhi", "new delhi": "Delhi",
  gj: "Gujarat", hr: "Haryana", hp: "Himachal Pradesh", jk: "Jammu and Kashmir",
  "jammu kashmir": "Jammu and Kashmir", jh: "Jharkhand", ka: "Karnataka",
  karntaka: "Karnataka", karnatak: "Karnataka", "karnataka state": "Karnataka",
  kl: "Kerala", mp: "Madhya Pradesh", mh: "Maharashtra", or: "Odisha",
  od: "Odisha", orissa: "Odisha", pb: "Punjab", rj: "Rajasthan", tn: "Tamil Nadu",
  "tamilnadu": "Tamil Nadu", ts: "Telangana", tg: "Telangana", up: "Uttar Pradesh",
  uk: "Uttarakhand", ua: "Uttarakhand", wb: "West Bengal", pondicherry: "Puducherry",
}));

const CITY_ALIASES = new Map(Object.entries({
  bangalore: "Bengaluru", bangaluru: "Bengaluru", bengaluru: "Bengaluru",
  bombay: "Mumbai", calcutta: "Kolkata", madras: "Chennai", poona: "Pune",
  gurgaon: "Gurugram", gurugram: "Gurugram", "new delhi": "New Delhi",
  "noida": "Noida", "greater noida": "Greater Noida", baroda: "Vadodara",
  cochin: "Kochi", trivandrum: "Thiruvananthapuram", mysore: "Mysuru",
  mangalore: "Mangaluru", belgaum: "Belagavi", hubli: "Hubballi",
}));

const clean = (value) => String(value || "").trim().toLowerCase()
  .replace(/\b(state|district|dist|india)\b/g, " ").replace(/[^a-z0-9]+/g, " ")
  .trim().replace(/\s+/g, " ");
const title = (value) => String(value || "").trim().toLowerCase()
  .replace(/\b\w/g, (x) => x.toUpperCase());

function distance(a, b) {
  if (!a) return b.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[b.length];
}

function pinState(pin) {
  const n = Number(String(pin || "").replace(/\D/g, "").slice(0, 2));
  if (n === 11) return "Delhi";
  if (n >= 12 && n <= 13) return "Haryana";
  if (n >= 14 && n <= 16) return "Punjab";
  if (n === 17) return "Himachal Pradesh";
  if (n >= 18 && n <= 19) return "Jammu and Kashmir";
  if (n >= 20 && n <= 28) return n === 24 || n === 26 ? "Uttarakhand" : "Uttar Pradesh";
  if (n >= 30 && n <= 34) return "Rajasthan";
  if (n >= 36 && n <= 39) return "Gujarat";
  if (n >= 40 && n <= 44) return "Maharashtra";
  if (n >= 45 && n <= 48) return "Madhya Pradesh";
  if (n === 49) return "Chhattisgarh";
  if (n === 50) return "Telangana";
  if (n >= 51 && n <= 53) return "Andhra Pradesh";
  if (n >= 56 && n <= 59) return "Karnataka";
  if (n >= 60 && n <= 66) return "Tamil Nadu";
  if (n >= 67 && n <= 69) return "Kerala";
  if (n >= 70 && n <= 74) return "West Bengal";
  if (n >= 75 && n <= 77) return "Odisha";
  if (n === 78) return "Assam";
  if (n === 79) return "North East";
  if (n >= 80 && n <= 82) return "Bihar";
  if (n >= 83 && n <= 85) return "Jharkhand";
  return null;
}

export function canonicalState(value, pincode) {
  const key = clean(value);
  if (STATE_ALIASES.has(key)) return STATE_ALIASES.get(key);
  const exact = STATES.find((state) => clean(state) === key);
  if (exact) return exact;
  if (key) {
    const close = STATES.map((state) => [state, distance(key, clean(state))])
      .sort((a, b) => a[1] - b[1])[0];
    if (close && close[1] <= Math.max(2, Math.floor(key.length * 0.18))) return close[0];
  }
  return pinState(pincode) || (value ? title(value) : "Unknown");
}

export function cleanDestinations(rows) {
  const pinCities = new Map(), globalCities = new Map();
  for (const row of rows) {
    const pin = String(row.pincode || "").replace(/\D/g, "");
    const raw = clean(row.city);
    if (pin.length !== 6 || !raw) continue;
    const city = CITY_ALIASES.get(raw) || title(row.city);
    globalCities.set(city, (globalCities.get(city) || 0) + 1);
    if (!pinCities.has(pin)) pinCities.set(pin, new Map());
    const counts = pinCities.get(pin);
    counts.set(city, (counts.get(city) || 0) + 1);
  }
  const preferredCity = new Map([...pinCities].map(([pin, counts]) => [
    pin, [...counts].sort((a, b) => b[1] - a[1] || (globalCities.get(b[0]) || 0) - (globalCities.get(a[0]) || 0) || a[0].localeCompare(b[0]))[0][0],
  ]));
  return rows.map((row) => {
    const pin = String(row.pincode || "").replace(/\D/g, "");
    const rawCity = clean(row.city);
    const city = CITY_ALIASES.get(rawCity) || preferredCity.get(pin) || (row.city ? title(row.city) : "Unknown");
    return { ...row, pincode: pin || row.pincode, state: canonicalState(row.state, pin), city };
  });
}
