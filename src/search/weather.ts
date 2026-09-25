export interface WeatherIntent { place: string; day: "today" | "tomorrow"; }
const weatherWords = /weather|forecast|temperature|rain|humidity|storm|ගුර|හැසිරීම|வானிலை|வெப்பநிலை|மழை/i;
export function extractWeatherIntent(query: string): WeatherIntent | null { if (!weatherWords.test(query)) return null; const match = query.match(/(?:\bin|\bfor|\bat|\bnear|ර|இல்)\s+([\p{L} .'-]{2,80}?)(?:\s+(?:today|tomorrow|අද|නිසළ|இன்று|நாளை))?$/iu); const place = match?.[1]?.trim(); if (!place) return null; return { place, day: /tomorrow|නිසළ|நாளை/i.test(query) ? "tomorrow" : "today" }; }
