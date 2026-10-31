import type { PrayerMethod } from '@/lib/prayer'

/** Where to put a person who will not share their location: a city, its timezone and the method
 *  its region's authority uses. Coordinates are the city centre — close enough for a prayer time,
 *  which moves by about four minutes per degree of longitude. */
export interface PrayerCity { name: string; lat: number; lon: number; tz: string; method: PrayerMethod }

export const PRAYER_CITIES: PrayerCity[] = [
  { name: 'Cairo', lat: 30.0444, lon: 31.2357, tz: 'Africa/Cairo', method: 'egyptian' },
  { name: 'Alexandria', lat: 31.2001, lon: 29.9187, tz: 'Africa/Cairo', method: 'egyptian' },
  { name: 'Riyadh', lat: 24.7136, lon: 46.6753, tz: 'Asia/Riyadh', method: 'ummalqura' },
  { name: 'Makkah', lat: 21.4225, lon: 39.8262, tz: 'Asia/Riyadh', method: 'ummalqura' },
  { name: 'Madinah', lat: 24.5247, lon: 39.5692, tz: 'Asia/Riyadh', method: 'ummalqura' },
  { name: 'Jeddah', lat: 21.4858, lon: 39.1925, tz: 'Asia/Riyadh', method: 'ummalqura' },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708, tz: 'Asia/Dubai', method: 'mwl' },
  { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773, tz: 'Asia/Dubai', method: 'mwl' },
  { name: 'Doha', lat: 25.2854, lon: 51.531, tz: 'Asia/Qatar', method: 'ummalqura' },
  { name: 'Kuwait City', lat: 29.3759, lon: 47.9774, tz: 'Asia/Kuwait', method: 'mwl' },
  { name: 'Manama', lat: 26.2285, lon: 50.586, tz: 'Asia/Bahrain', method: 'mwl' },
  { name: 'Muscat', lat: 23.588, lon: 58.3829, tz: 'Asia/Muscat', method: 'mwl' },
  { name: 'Amman', lat: 31.9454, lon: 35.9284, tz: 'Asia/Amman', method: 'mwl' },
  { name: 'Beirut', lat: 33.8938, lon: 35.5018, tz: 'Asia/Beirut', method: 'mwl' },
  { name: 'Damascus', lat: 33.5138, lon: 36.2765, tz: 'Asia/Damascus', method: 'mwl' },
  { name: 'Baghdad', lat: 33.3152, lon: 44.3661, tz: 'Asia/Baghdad', method: 'mwl' },
  { name: 'Istanbul', lat: 41.0082, lon: 28.9784, tz: 'Europe/Istanbul', method: 'mwl' },
  { name: 'Casablanca', lat: 33.5731, lon: -7.5898, tz: 'Africa/Casablanca', method: 'mwl' },
  { name: 'Tunis', lat: 36.8065, lon: 10.1815, tz: 'Africa/Tunis', method: 'mwl' },
  { name: 'Algiers', lat: 36.7538, lon: 3.0588, tz: 'Africa/Algiers', method: 'mwl' },
  { name: 'Khartoum', lat: 15.5007, lon: 32.5599, tz: 'Africa/Khartoum', method: 'egyptian' },
  { name: 'London', lat: 51.5074, lon: -0.1278, tz: 'Europe/London', method: 'mwl' },
  { name: 'Paris', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris', method: 'mwl' },
  { name: 'Berlin', lat: 52.52, lon: 13.405, tz: 'Europe/Berlin', method: 'mwl' },
  { name: 'New York', lat: 40.7128, lon: -74.006, tz: 'America/New_York', method: 'isna' },
  { name: 'Toronto', lat: 43.6532, lon: -79.3832, tz: 'America/Toronto', method: 'isna' },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles', method: 'isna' },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney', method: 'mwl' },
  { name: 'Karachi', lat: 24.8607, lon: 67.0011, tz: 'Asia/Karachi', method: 'karachi' },
  { name: 'Dhaka', lat: 23.8103, lon: 90.4125, tz: 'Asia/Dhaka', method: 'karachi' },
  { name: 'Kuala Lumpur', lat: 3.139, lon: 101.6869, tz: 'Asia/Kuala_Lumpur', method: 'mwl' },
  { name: 'Jakarta', lat: -6.2088, lon: 106.8456, tz: 'Asia/Jakarta', method: 'mwl' },
]
