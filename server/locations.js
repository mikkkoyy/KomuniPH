import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const locationsPath = resolve(__dirname, 'locations.json');

let locations = null;

function loadLocations() {
  if (!locations) {
    try {
      locations = JSON.parse(readFileSync(locationsPath, 'utf-8'));
    } catch (e) {
      console.error('[LOCATIONS] Failed to load locations data:', e.message);
      locations = {};
    }
  }
  return locations;
}

export function getCountries() {
  const data = loadLocations();
  return Object.keys(data);
}

export function getCities(country) {
  const data = loadLocations();
  return data[country] || [];
}

export function getBarangays(country, city) {
  const data = loadLocations();
  const cityObj = data[country]?.find(c => c.name === city);
  return cityObj?.barangays || [];
}

export function getAllLocations() {
  const data = loadLocations();

  const countries = Object.keys(data);
  const cities = {};
  const barangays = {};

  for (const [country, cityList] of Object.entries(data)) {
    cities[country] = cityList.map(c => c.name);
    barangays[country] = {};
    for (const city of cityList) {
      barangays[country][city.name] = city.barangays;
    }
  }

  return { countries, cities, barangays };
}
