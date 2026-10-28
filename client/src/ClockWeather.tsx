import { useEffect, useState } from "react";
import {
  CalendarDays, ChevronDown, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain,
  CloudSnow, CloudSun, Droplets, MapPin, RefreshCw, Sun, Wind
} from "lucide-react";
import { weatherConditionForCode, type WeatherIconKey } from "../../shared/weather";

const timeZone = "America/Argentina/Catamarca";
const refreshIntervalMs = 10 * 60 * 1000;
const locationStorageKey = "comedor-weather-location";
const locations = [
  "San Fernando del Valle de Catamarca",
  "Andalgalá",
  "Belén",
  "Fiambalá",
  "Santa María",
  "Tinogasta"
] as const;

type WeatherSnapshot = {
  location: { name: string; region: string | null; country: string; latitude: number; longitude: number };
  current: {
    temperatureC: number;
    feelsLikeC: number;
    humidityPercent: number;
    windKmh: number;
    weatherCode: number;
    precipitationProbabilityPercent: number | null;
    observedAt: string;
  };
  fetchedAt: string;
  source: "Open-Meteo";
  cacheHit: boolean;
  cacheAgeSeconds: number;
};

const weatherIcons: Record<WeatherIconKey, typeof Sun> = {
  sun: Sun,
  "partly-cloudy": CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning
};

function initialLocation(): string {
  try {
    const saved = window.localStorage.getItem(locationStorageKey);
    if (saved && locations.includes(saved as (typeof locations)[number])) return saved;
  } catch {
    // Continue with the institutional default when storage is unavailable.
  }
  return locations[0];
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(date);
}

function formatDate(date: Date): string {
  const value = new Intl.DateTimeFormat("es-AR", {
    timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(date);
  return value.charAt(0).toLocaleUpperCase("es-AR") + value.slice(1);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(value));
}

export function ClockWeather() {
  const [now, setNow] = useState(() => new Date());
  const [location, setLocation] = useState(initialLocation);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<"loading" | "ready" | "error">("loading");
  const [weatherError, setWeatherError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(locationStorageKey, location);
    } catch {
      // The selection remains usable for this page even without local storage.
    }
  }, [location]);

  useEffect(() => {
    let active = true;
    setWeather(null);
    setWeatherError("");
    setWeatherStatus("loading");
    void fetch(`/api/weather?city=${encodeURIComponent(location)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    }).then(async (response) => {
      const body = await response.json() as WeatherSnapshot | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error : "No se pudo consultar el clima.");
      return body as WeatherSnapshot;
    }).then((result) => {
      if (!active) return;
      setWeather(result);
      setWeatherStatus("ready");
    }).catch((error: unknown) => {
      if (!active) return;
      setWeather(null);
      setWeatherError(error instanceof Error ? error.message : "No se pudo consultar el clima.");
      setWeatherStatus("error");
    });
    return () => { active = false; };
  }, [location, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey((value) => value + 1), refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, []);

  const condition = weather ? weatherConditionForCode(weather.current.weatherCode) : null;
  const WeatherIcon = condition ? weatherIcons[condition.icon] : Cloud;

  return <section className="clock-weather" aria-label="Fecha, hora y clima">
    <div className="clock-weather__time">
      <CalendarDays size={17} aria-hidden="true" />
      <div className="clock-weather__time-copy">
        <span className="clock-weather__date">{formatDate(now)}</span>
        <time className="clock-weather__clock" dateTime={now.toISOString()}>{formatClock(now)}</time>
      </div>
    </div>

    <div className={`clock-weather__current clock-weather__current--${weatherStatus}`} aria-live="polite">
      {weatherStatus === "ready" && weather ? <>
        <WeatherIcon className="clock-weather__icon" size={29} strokeWidth={1.7} aria-hidden="true" />
        <div className="clock-weather__weather-copy">
          <strong>{Math.round(weather.current.temperatureC)} °C <span>{condition?.label}</span></strong>
          <span>Sensación {Math.round(weather.current.feelsLikeC)} °C</span>
        </div>
      </> : weatherStatus === "loading" ? <>
        <RefreshCw className="clock-weather__icon clock-weather__spin" size={21} aria-hidden="true" />
        <span>Consultando clima…</span>
      </> : <>
        <Cloud className="clock-weather__icon" size={25} aria-hidden="true" />
        <span className="clock-weather__weather-copy">Clima no disponible</span>
        <button className="clock-weather__retry" type="button" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Reintentar consulta del clima" title={weatherError}>
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </>}
    </div>

    <div className="clock-weather__details">
      {weatherStatus === "ready" && weather ? <>
        <span><Droplets size={13} aria-hidden="true" /> {weather.current.humidityPercent}%</span>
        <span><Wind size={13} aria-hidden="true" /> {Math.round(weather.current.windKmh)} km/h</span>
        <span className="clock-weather__precipitation">{weather.current.precipitationProbabilityPercent === null
          ? "Prob. lluvia s/d"
          : `Lluvia ${weather.current.precipitationProbabilityPercent}%`}</span>
      </> : weatherStatus === "error" ? <span className="clock-weather__error" role="status">{weatherError}</span> : null}
      <label className="clock-weather__location">
        <MapPin size={13} aria-hidden="true" />
        <select aria-label="Localidad del clima" value={location} onChange={(event) => setLocation(event.target.value)}>
          {locations.map((place) => <option key={place} value={place}>{place}</option>)}
        </select>
        <ChevronDown size={12} aria-hidden="true" />
      </label>
      {weather && weatherStatus === "ready" && <span className="clock-weather__updated">
        {weather.cacheHit ? "Caché" : "Actualizado"} {formatTime(weather.fetchedAt)} · observación {formatTime(weather.current.observedAt)}
      </span>}
    </div>
  </section>;
}