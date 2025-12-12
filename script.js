document.addEventListener("DOMContentLoaded", () => {
  const earthquakeBaseUrl = "https://earthquake.usgs.gov/fdsnws/event/1/query";
  const weatherAlertsUrl = "https://api.weather.gov/alerts/active";
  const solarFlaresUrl = "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json";
  const auroraUrl = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
  const auroraInlineFallback = [
    { lat: 67.2, lon: -33.8, value: 85 },
    { lat: 65.1, lon: -95.4, value: 78 },
    { lat: 63.0, lon: 15.5, value: 62 },
    { lat: 61.5, lon: -150.0, value: 54 },
    { lat: 58.9, lon: 135.2, value: 48 },
    { lat: 55.3, lon: 20.1, value: 32 },
    { lat: 52.8, lon: -3.0, value: 24 },
  ];
  const auroraSources = [
    { label: "direct", url: auroraUrl },
    {
      label: "allorigins-wrapped",
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(auroraUrl)}`,
      parse: async (res) => {
        const data = await res.json();
        if (data && data.contents) return JSON.parse(data.contents);
        throw new Error("Wrapped response missing contents");
      },
    },
    {
      label: "allorigins-raw",
      url: `https://api.allorigins.win/raw?url=${encodeURIComponent(auroraUrl)}`,
    },
  ];
  const weatherApiKey = "89c1779e928e65c73d9964c3527b0eb3";
  const defaultWeatherQuery = "Fairbanks, Alaska";
  const weatherFallbackLocation = {
    lat: 64.84,
    lon: -147.72,
    name: "Fairbanks, Alaska (sample data)",
  };
  const weatherFallbackData = {
    timezone_offset: -32400,
    current: {
      dt: Math.floor(Date.now() / 1000),
      temp: -7,
      feels_like: -12,
      wind_speed: 6.2,
      wind_gust: 11.3,
      uvi: 0.6,
      clouds: 48,
    },
    daily: [
      {
        dt: Math.floor(Date.now() / 1000),
        temp: { day: -7, max: -5, min: -13, night: -12 },
        wind_speed: 6.2,
        clouds: 48,
        uvi: 0.6,
      },
      {
        dt: Math.floor(Date.now() / 1000) + 86400,
        temp: { day: -6, max: -4, min: -11, night: -9 },
        wind_speed: 5.5,
        clouds: 62,
        uvi: 0.8,
      },
      {
        dt: Math.floor(Date.now() / 1000) + 86400 * 2,
        temp: { day: -4, max: -2, min: -9, night: -7 },
        wind_speed: 7.1,
        clouds: 38,
        uvi: 1.4,
      },
      {
        dt: Math.floor(Date.now() / 1000) + 86400 * 3,
        temp: { day: -3, max: -1, min: -8, night: -6 },
        wind_speed: 8.6,
        clouds: 72,
        uvi: 1.0,
      },
    ],
  };

  // Hint to canvas contexts (Leaflet heatmap, charts) that we’ll read pixels often to avoid console warnings.
  if (HTMLCanvasElement && HTMLCanvasElement.prototype?.getContext) {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, options) {
      const opts =
        type === "2d" ? { willReadFrequently: true, ...(options || {}) } : options || {};
      return originalGetContext.call(this, type, opts);
    };
  }

  const earthquakeList = document.getElementById("earthquake-list");
  const alertList = document.getElementById("alert-list");
  const flareList = document.getElementById("flare-list");
  const summaryBody = document.getElementById("summary-body");
  const errorBox = document.getElementById("error-box");
  const errorMessage = document.getElementById("error-message");
  const feedList = document.getElementById("feed-list");
  const mapStatus = document.getElementById("map-status");
  const flareChartEl = document.getElementById("flare-chart");
  const auroraStatus = document.getElementById("aurora-status");
  const auroraMapEl = document.getElementById("aurora-map");
  const themeToggle = document.getElementById("theme-toggle");
  const weatherForm = document.getElementById("weather-search-form");
  const weatherQueryInput = document.getElementById("weather-query");
  const weatherStatus = document.getElementById("weather-status");
  const weatherResults = document.getElementById("weather-results");
  const weatherLocationEl = document.getElementById("weather-location");
  const weatherUpdatedEl = document.getElementById("weather-updated");
  const weatherGrid = document.getElementById("weather-grid");
  const forecastCards = document.getElementById("forecast-cards");
  const weatherAssistantLink = document.getElementById("weather-assistant-link");

  const filtersForm = document.getElementById("filters-form");
  const minMagInput = document.getElementById("min-mag");
  const modeSelect = document.getElementById("mode-select");
  const modeButtons = document.querySelectorAll(".mode-btn");
  const minMagRange = document.getElementById("min-mag-range");
  const minMagValue = document.getElementById("min-mag-value");
  const timeWindowRadios = document.querySelectorAll('input[name="time-window"]');
  const sortSelect = document.getElementById("sort-select");
  const highlightAftershocks = document.getElementById("highlight-aftershocks");
  const autoRefreshCheckbox = document.getElementById("auto-refresh");
  const statTotal = document.getElementById("stat-total");
  const statStrongest = document.getElementById("stat-strongest");
  const statStrongestMeta = document.getElementById("stat-strongest-meta");
  const statDepth = document.getElementById("stat-depth");

  const sections = {
    overview: document.getElementById("overview"),
    earth: document.getElementById("earth"),
    space: document.getElementById("space"),
  };

  let earthquakes = [];
  let alerts = [];
  let flares = [];
  let feedEvents = [];
  let feedIntervalId = null;
  let autoRefreshId = null;
  let currentWindow = "day";
  let map;
  let markersLayer;
  let mapReady = false;
  let flareChart;
  let auroraMap;
  let auroraLayer;
  let auroraPoints = [];
  let auroraHeatLayer;
  let auroraUsingFallback = false;
  let weatherData = null;
  let weatherLocation = null;
  let openWeatherDisabled = false;
  const markerLookup = new Map();

  const showError = (message) => {
    if (!message) {
      errorBox.classList.add("hidden");
      errorMessage.textContent = "";
      return;
    }
    errorBox.classList.remove("hidden");
    errorMessage.textContent = message;
  };

  const setMapStatus = (message, isError = false) => {
    const statusEl = mapStatus;
    if (!statusEl) return;
    if (!message) {
      statusEl.classList.add("hidden");
      statusEl.textContent = "";
      statusEl.classList.remove("error");
      return;
    }
    statusEl.textContent = message;
    statusEl.classList.remove("hidden");
    statusEl.classList.toggle("error", isError);
  };

  const setAuroraStatus = (message, isError = false) => {
    if (!auroraStatus) return;
    if (!message) {
      auroraStatus.classList.add("hidden");
      auroraStatus.textContent = "";
      auroraStatus.classList.remove("error");
      return;
    }
    auroraStatus.textContent = message;
    auroraStatus.classList.remove("hidden");
    auroraStatus.classList.toggle("error", isError);
  };

  const getStoredTheme = () => {
    try {
      const value = localStorage.getItem("theme");
      if (value === "light" || value === "dark") return value;
    } catch (_) {
      // ignore storage issues
    }
    return null;
  };

  const storeTheme = (theme) => {
    try {
      localStorage.setItem("theme", theme);
    } catch (_) {
      // ignore storage issues
    }
  };

  const applyTheme = (theme, persist = true) => {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    if (persist) storeTheme(next);
    if (themeToggle) {
      themeToggle.textContent = next === "light" ? "Dark mode" : "Light mode";
    }
  };

  const detectPreferredTheme = () => {
    const stored = getStoredTheme();
    if (stored) return stored;
    if (window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return "dark";
  };

  const initTheme = () => {
    applyTheme(detectPreferredTheme(), false);
    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || "dark";
        const next = current === "light" ? "dark" : "light";
        applyTheme(next);
      });
    }
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const handler = (event) => {
        if (getStoredTheme()) return;
        applyTheme(event.matches ? "light" : "dark", false);
      };
      if (mq.addEventListener) mq.addEventListener("change", handler);
      else if (mq.addListener) mq.addListener(handler);
    }
  };

  const initWeatherAssistantLink = () => {
    if (!weatherAssistantLink || !weatherApiKey) return;
    weatherAssistantLink.href = `https://openweathermap.org/weather-assistant?apikey=${weatherApiKey}`;
  };

  const setWeatherStatus = (message, isError = false) => {
    if (!weatherStatus) return;
    weatherStatus.textContent = message;
    weatherStatus.classList.toggle("error", isError);
  };

  const parseCoordinateQuery = (query) => {
    if (!query) return null;
    const parts = query.split(",").map((p) => Number(p.trim()));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      const [lat, lon] = parts;
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return {
          lat,
          lon,
          name: `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`,
        };
      }
    }
    return null;
  };

  const formatWeatherDate = (unixSeconds, offsetSeconds, options) => {
    if (!unixSeconds) return "";
    const date = new Date((unixSeconds + (offsetSeconds || 0)) * 1000);
    return date.toLocaleString(
      undefined,
      options || { hour: "2-digit", minute: "2-digit" }
    );
  };

  const uvRecommendation = (uv) => {
    if (!Number.isFinite(uv)) return "UV data unavailable.";
    if (uv < 3) return "Low: Sunglasses around midday.";
    if (uv < 6) return "Moderate: SPF 30+, cover up at noon.";
    if (uv < 8) return "High: Seek shade midday, reapply sunscreen.";
    if (uv < 11) return "Very high: Limit midday sun, long sleeves recommended.";
    return "Extreme: Avoid midday sun, SPF 50+, full coverage.";
  };

  const windNarrative = (speed, gust) => {
    const spd = Number(speed) || 0;
    const gustNum = Number(gust);
    let summary = "Calm to light breeze.";
    if (spd >= 17) summary = "Storm conditions possible—use caution.";
    else if (spd >= 12) summary = "Strong and gusty—secure loose items.";
    else if (spd >= 7) summary = "Breezy and cooler on skin.";
    const gustText = Number.isFinite(gustNum)
      ? ` Gusts ${gustNum.toFixed(1)} m/s (${Math.round(gustNum * 2.237)} mph).`
      : "";
    return `${summary}${gustText}`;
  };

  const cloudImpact = (clouds) => {
    const pct = Number.isFinite(Number(clouds)) ? Number(clouds) : 0;
    if (pct >= 85) return "Thick cover — aurora visibility poor.";
    if (pct >= 60) return "Broken clouds — limited aurora views.";
    if (pct >= 35) return "Partly cloudy — watch for clear gaps.";
    return "Clear to mostly clear — great sky window.";
  };

  const renderWeatherTiles = (current) => {
    if (!weatherGrid || !current) return;
    const wind = Number(current.wind_speed) || 0;
    const gust = Number(current.wind_gust);
    const tiles = [
      {
        label: "Temperature",
        value: `${Math.round(current.temp ?? 0)}°C`,
        detail: Number.isFinite(current.feels_like)
          ? `Feels like ${Math.round(current.feels_like)}°C`
          : "",
      },
      {
        label: "Wind speed",
        value: `${wind.toFixed(1)} m/s (${Math.round(wind * 2.237)} mph)`,
        detail: windNarrative(wind, gust),
      },
      {
        label: "UV index",
        value: Number.isFinite(current.uvi) ? current.uvi.toFixed(1) : "n/a",
        detail: "UV care",
        uvAdvice: uvRecommendation(current.uvi),
      },
      {
        label: "Cloud coverage",
        value: `${Number(current.clouds ?? 0).toFixed(0)}%`,
        detail: cloudImpact(current.clouds),
      },
    ];

    weatherGrid.innerHTML = tiles
      .map(
        (tile) =>
          `<div class="weather-tile"><small>${tile.label}</small><strong>${tile.value}</strong>${
            tile.detail ? `<small>${tile.detail}</small>` : ""
          }${tile.uvAdvice ? `<span class="uv-advice">${tile.uvAdvice}</span>` : ""}</div>`
      )
      .join("");
  };

  const renderForecastCards = (daily = [], offset = 0) => {
    if (!forecastCards) return;
    const days = daily.slice(1, 4);
    if (!days.length) {
      forecastCards.innerHTML = "<p class=\"weather-status\">No forecast data.</p>";
      return;
    }
    forecastCards.innerHTML = days
      .map((day) => {
        const label = formatWeatherDate(day.dt, offset, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const max = Math.round(day.temp?.max ?? day.temp?.day ?? 0);
        const min = Math.round(day.temp?.min ?? day.temp?.night ?? 0);
        const wind = Number(day.wind_speed) || 0;
        const clouds = Number(day.clouds ?? 0);
        const uv = Number.isFinite(day.uvi) ? day.uvi.toFixed(1) : "n/a";
        return `<div class="forecast-card">
          <h5>${label}</h5>
          <p class="forecast-meta">${max}° / ${min}°C • Wind ${wind.toFixed(1)} m/s</p>
          <p class="forecast-meta">Clouds: ${clouds}% • UV: ${uv}</p>
          <p>${cloudImpact(clouds)}</p>
        </div>`;
      })
      .join("");
  };

  const renderWeather = (data, locationLabel) => {
    if (!data?.current) return;
    if (weatherResults) weatherResults.classList.remove("hidden");
    if (weatherLocationEl) weatherLocationEl.textContent = locationLabel || "Selected location";
    if (weatherUpdatedEl) {
      weatherUpdatedEl.textContent = data.current.dt
        ? `Updated: ${formatWeatherDate(data.current.dt, data.timezone_offset, {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}`
        : "";
    }
    renderWeatherTiles(data.current);
    renderForecastCards(data.daily || [], data.timezone_offset || 0);
  };

  const geocodeLocation = async (query) => {
    const trimmed = (query || "").trim();
    if (!trimmed) throw new Error("Enter a city or coordinates to search.");
    const coord = parseCoordinateQuery(trimmed);
    if (coord) return coord;

    const currentWeatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
      trimmed
    )}&appid=${weatherApiKey}`;
    try {
      const data = await fetchJson(currentWeatherUrl);
      if (data?.coord?.lat !== undefined && data?.coord?.lon !== undefined) {
        const nameParts = [data.name, data.sys?.country].filter(Boolean);
        return {
          lat: data.coord.lat,
          lon: data.coord.lon,
          name: nameParts.join(", ") || trimmed,
        };
      }
    } catch (err) {
      console.error("Primary OpenWeather geocode failed:", err);
    }

    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
      trimmed
    )}&limit=1&appid=${weatherApiKey}`;
    const results = await fetchJson(url);
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error("No matching location found.");
    }
    const match = results[0];
    const nameParts = [match.name, match.state, match.country].filter(Boolean);
    return {
      lat: match.lat,
      lon: match.lon,
      name: nameParts.join(", ") || trimmed,
    };
  };

  const geocodeWithOpenMeteo = async (query) => {
    const trimmed = (query || "").trim();
    if (!trimmed) throw new Error("Enter a city or coordinates to search.");
    const coord = parseCoordinateQuery(trimmed);
    if (coord) return coord;
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      trimmed
    )}&count=1&language=en&format=json`;
    const results = await fetchJson(url);
    if (!Array.isArray(results?.results) || results.results.length === 0) {
      throw new Error("No matching location found.");
    }
    const match = results.results[0];
    const nameParts = [match.name, match.admin1, match.country].filter(Boolean);
    return {
      lat: match.latitude,
      lon: match.longitude,
      name: nameParts.join(", "),
    };
  };

  const aggregateDailyForecast = (list, tzOffset = 0) => {
    if (!Array.isArray(list)) return [];
    const dayBuckets = new Map();
    list.forEach((entry) => {
      if (!entry?.dt) return;
      const adjustedSeconds = entry.dt + tzOffset;
      const dayKey = new Date(adjustedSeconds * 1000).toISOString().split("T")[0];
      const bucket = dayBuckets.get(dayKey) || {
        dt: entry.dt,
        max: -Infinity,
        min: Infinity,
        cloudsSum: 0,
        count: 0,
        windMax: 0,
        gustMax: 0,
      };
      const tempMax = entry.main?.temp_max ?? entry.main?.temp ?? null;
      const tempMin = entry.main?.temp_min ?? entry.main?.temp ?? null;
      if (Number.isFinite(tempMax)) bucket.max = Math.max(bucket.max, tempMax);
      if (Number.isFinite(tempMin)) bucket.min = Math.min(bucket.min, tempMin);
      if (Number.isFinite(entry.clouds?.all)) {
        bucket.cloudsSum += entry.clouds.all;
        bucket.count += 1;
      }
      const wind = Number(entry.wind?.speed);
      const gust = Number(entry.wind?.gust);
      if (Number.isFinite(wind)) bucket.windMax = Math.max(bucket.windMax, wind);
      if (Number.isFinite(gust)) bucket.gustMax = Math.max(bucket.gustMax, gust);
      if (entry.dt) bucket.dt = entry.dt;
      dayBuckets.set(dayKey, bucket);
    });

    return Array.from(dayBuckets.values())
      .map((b) => {
        const max = Number.isFinite(b.max) ? b.max : null;
        const min = Number.isFinite(b.min) ? b.min : null;
        const avg = Number.isFinite(max) && Number.isFinite(min) ? (max + min) / 2 : max || min;
        const clouds =
          b.count > 0 ? Math.round((b.cloudsSum / b.count) * 10) / 10 : b.cloudsSum || 0;
        return {
          dt: b.dt,
          temp: { day: avg, max, min, night: min },
          wind_speed: b.windMax,
          wind_gust: b.gustMax,
          clouds,
          uvi: null,
        };
      })
      .sort((a, b) => a.dt - b.dt);
  };

  const fetchWeatherForecast = async (lat, lon) => {
    const params = (base) => {
      const url = new URL(base);
      url.searchParams.set("lat", lat);
      url.searchParams.set("lon", lon);
      url.searchParams.set("units", "metric");
      url.searchParams.set("appid", weatherApiKey);
      return url.toString();
    };
    const currentUrl = params("https://api.openweathermap.org/data/2.5/weather");
    const forecastUrl = params("https://api.openweathermap.org/data/2.5/forecast");

    const currentData = await fetchJson(currentUrl);
    let forecastData = null;
    try {
      forecastData = await fetchJson(forecastUrl);
    } catch (err) {
      console.warn("Forecast endpoint failed, continuing with current conditions only.", err);
    }

    const tzOffset =
      Number(currentData?.timezone) ||
      Number(forecastData?.city?.timezone) ||
      0;

    const current = {
      dt: currentData?.dt,
      temp: currentData?.main?.temp,
      feels_like: currentData?.main?.feels_like,
      wind_speed: currentData?.wind?.speed,
      wind_gust: currentData?.wind?.gust,
      uvi: currentData?.uvi ?? null,
      clouds: currentData?.clouds?.all,
    };

    const daily = aggregateDailyForecast(forecastData?.list, tzOffset);

    return {
      timezone_offset: tzOffset,
      current,
      daily,
    };
  };

  const fetchOpenMeteoForecast = async (lat, lon) => {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: "temperature_2m,cloudcover,uv_index,wind_speed_10m,wind_gusts_10m",
      daily:
        "temperature_2m_max,temperature_2m_min,uv_index_max,cloudcover_mean,wind_speed_10m_max,wind_gusts_10m_max",
      current_weather: "true",
      timezone: "auto",
      forecast_days: "4",
    });
    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
    return fetchJson(url);
  };

  const adaptOpenMeteoToWeather = (raw) => {
    if (!raw) return null;
    const offsetSeconds = Number(raw.utc_offset_seconds || 0);
    const currentTimeIso = raw.current_weather?.time || raw.hourly?.time?.[0];
    const currentTime = currentTimeIso ? new Date(currentTimeIso).getTime() / 1000 : undefined;
    const findHourlyValue = (key) => {
      if (!raw.hourly || !Array.isArray(raw.hourly.time)) return undefined;
      const idx = raw.hourly.time.findIndex((t) => t === currentTimeIso);
      if (idx === -1) return undefined;
      return raw.hourly[key]?.[idx];
    };
    const current = {
      dt: currentTime,
      temp: raw.current_weather?.temperature ?? findHourlyValue("temperature_2m"),
      feels_like: raw.current_weather?.temperature ?? findHourlyValue("temperature_2m"),
      wind_speed: raw.current_weather?.windspeed ?? raw.current_weather?.wind_speed ?? 0,
      wind_gust: raw.current_weather?.wind_gusts ?? findHourlyValue("wind_gusts_10m"),
      uvi: findHourlyValue("uv_index"),
      clouds: findHourlyValue("cloudcover"),
    };

    const daily = [];
    const times = raw.daily?.time || [];
    times.forEach((iso, idx) => {
      const dt = iso ? new Date(iso).getTime() / 1000 : undefined;
      const max = raw.daily?.temperature_2m_max?.[idx];
      const min = raw.daily?.temperature_2m_min?.[idx];
      const wind = raw.daily?.wind_speed_10m_max?.[idx];
      const gust = raw.daily?.wind_gusts_10m_max?.[idx];
      const clouds = raw.daily?.cloudcover_mean?.[idx];
      const uvi = raw.daily?.uv_index_max?.[idx];
      daily.push({
        dt,
        temp: {
          day: Number.isFinite(max) && Number.isFinite(min) ? (max + min) / 2 : max,
          max,
          min,
          night: min,
        },
        wind_speed: wind,
        wind_gust: gust,
        clouds,
        uvi,
      });
    });

    return {
      timezone_offset: offsetSeconds,
      current,
      daily,
    };
  };

  const useWeatherFallback = (reason) => {
    if (!weatherFallbackData?.current) {
      setWeatherStatus(reason || "Weather unavailable.", true);
      return;
    }
    weatherData = weatherFallbackData;
    weatherLocation = weatherFallbackLocation;
    renderWeather(weatherFallbackData, weatherFallbackLocation.name);
    setWeatherStatus(
      reason ||
        "Showing sample weather data. Replace the OpenWeather API key to restore live data.",
      true
    );
  };

  const loadWeatherForQuery = async (query) => {
    const attemptOpenMeteo = async (reason) => {
      try {
        setWeatherStatus(`${reason || "Switching"} to Open-Meteo...`);
        const location = await geocodeWithOpenMeteo(query);
        setWeatherStatus(`Loading forecast for ${location.name} (Open-Meteo)...`);
        const raw = await fetchOpenMeteoForecast(location.lat, location.lon);
        const adapted = adaptOpenMeteoToWeather(raw);
        if (!adapted?.current) throw new Error("Open-Meteo returned no data.");
        weatherData = adapted;
        weatherLocation = location;
        renderWeather(adapted, `${location.name} (Open-Meteo)`);
        setWeatherStatus(`Forecast updated via Open-Meteo for ${location.name}`);
        return true;
      } catch (fallbackErr) {
        console.error("Open-Meteo fallback failed:", fallbackErr);
        return false;
      }
    };

    try {
      openWeatherDisabled = false;
      if (openWeatherDisabled) {
        const success = await attemptOpenMeteo("OpenWeather unavailable.");
        if (!success) useWeatherFallback("Unable to reach weather services right now.");
        return;
      }
      setWeatherStatus(`Searching for "${query}"...`);
      const location = await geocodeLocation(query);
      setWeatherStatus(`Loading forecast for ${location.name}...`);
      const data = await fetchWeatherForecast(location.lat, location.lon);
      weatherData = data;
      weatherLocation = location;
      renderWeather(data, location.name);
      setWeatherStatus(`Forecast updated for ${location.name}`);
    } catch (err) {
      console.error(err);
      const isUnauthorized =
        err?.status === 401 ||
        (typeof err?.message === "string" && err.message.includes("401"));
      if (isUnauthorized) {
        openWeatherDisabled = true;
        const success = await attemptOpenMeteo(
          "OpenWeather rejected the API key (401)."
        );
        if (!success) {
          useWeatherFallback(
            "OpenWeather rejected the key and Open-Meteo is unavailable. Showing sample Fairbanks data."
          );
        }
        return;
      }
      const openMeteoSuccess = await attemptOpenMeteo("OpenWeather request failed.");
      if (openMeteoSuccess) return;
      setWeatherStatus(err?.message || "Unable to load weather right now.", true);
      if (weatherResults) weatherResults.classList.add("hidden");
    }
  };

  const smoothNav = () => {
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute("href"));
        if (target) {
          window.scrollTo({
            top: target.offsetTop - 60,
            behavior: "smooth",
          });
        }
      });
    });
  };

  const computeStartTime = (windowValue) => {
    const now = new Date();
    const hours =
      windowValue === "hour" ? 1 : windowValue === "week" ? 24 * 7 : 24;
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
    return start.toISOString();
  };

  const ensureLeafletLoaded = () =>
    new Promise((resolve, reject) => {
      if (window.L) {
        resolve();
        return;
      }

      const existingScript = document.querySelector(
        'script[data-leaflet-fallback="true"]'
      );
      if (existingScript) {
        existingScript.addEventListener("load", () => {
          if (window.L) resolve();
          else reject(new Error("Leaflet did not initialize."));
        });
        existingScript.addEventListener("error", () =>
          reject(new Error("Leaflet failed to load."))
        );
        return;
      }

      const fallbackCss = document.createElement("link");
      fallbackCss.rel = "stylesheet";
      fallbackCss.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";
      fallbackCss.crossOrigin = "";
      fallbackCss.setAttribute("data-leaflet-fallback", "true");
      document.head.appendChild(fallbackCss);

      const fallbackScript = document.createElement("script");
      fallbackScript.src =
        "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
      fallbackScript.crossOrigin = "";
      fallbackScript.setAttribute("data-leaflet-fallback", "true");
      fallbackScript.onload = () => {
        if (window.L) resolve();
        else reject(new Error("Leaflet failed to initialize after load."));
      };
      fallbackScript.onerror = () =>
        reject(new Error("Leaflet script could not be fetched."));
      document.head.appendChild(fallbackScript);
    });

  const ensureLeafletHeatLoaded = () =>
    new Promise((resolve, reject) => {
      if (window.L && window.L.heatLayer) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-leaflet-heat="true"]');
      if (existing) {
        existing.addEventListener("load", () => (window.L && window.L.heatLayer ? resolve() : reject(new Error("Leaflet.heat failed to init"))));
        existing.addEventListener("error", () => reject(new Error("Leaflet.heat failed to load")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js";
      script.defer = true;
      script.setAttribute("data-leaflet-heat", "true");
      script.onload = () => (window.L && window.L.heatLayer ? resolve() : reject(new Error("Leaflet.heat failed to init")));
      script.onerror = () => reject(new Error("Leaflet.heat failed to load"));
      document.head.appendChild(script);
    });

  const ensureChartJsLoaded = () =>
    new Promise((resolve, reject) => {
      if (window.Chart) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-chartjs="true"]');
      if (existing) {
        existing.addEventListener("load", () => (window.Chart ? resolve() : reject(new Error("Chart.js failed to init"))));
        existing.addEventListener("error", () => reject(new Error("Chart.js failed to load")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      script.defer = true;
      script.setAttribute("data-chartjs", "true");
      script.onload = () => (window.Chart ? resolve() : reject(new Error("Chart.js failed to init")));
      script.onerror = () => reject(new Error("Chart.js failed to load"));
      document.head.appendChild(script);
    });

  const fetchJson = async (url, customParser) => {
    const res = await fetch(url);
    const ok = res.ok || res.status === 0; // status 0 for file:// requests
    if (!ok) {
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch (_) {
        bodyText = "";
      }
      const err = new Error(`HTTP ${res.status}${bodyText ? `: ${bodyText}` : ""}`);
      err.status = res.status;
      err.body = bodyText;
      throw err;
    }
    if (typeof customParser === "function") return customParser(res);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (err) {
      const sample = text.slice(0, 80).trim();
      const hint = sample.startsWith("<") ? "Non-JSON (HTML) response" : "Invalid JSON";
      const wrapped = new Error(`${hint} from ${url}`);
      wrapped.original = err;
      throw wrapped;
    }
  };

  const fetchEarthquakes = async (windowValue = currentWindow) => {
    try {
      currentWindow = windowValue;
      const url = new URL(earthquakeBaseUrl);
      url.searchParams.set("format", "geojson");
      url.searchParams.set("orderby", "time");
      url.searchParams.set("limit", "150");
      url.searchParams.set("starttime", computeStartTime(windowValue));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to load earthquakes");
      const data = await res.json();
      earthquakes = (data.features || []).map((feature) => {
        const { mag, place, time } = feature.properties || {};
        const [lon, lat, depth] = feature.geometry?.coordinates || [];
        return {
          id: feature.id,
          mag,
          place,
          time,
          lat,
          lon,
          depth,
        };
      });
      updateEarthquakes();
    } catch (err) {
      console.error(err);
      showError("Unable to load earthquake data right now.");
      earthquakeList.innerHTML = "<li>Unable to load earthquakes.</li>";
    }
  };

  const fetchWeatherAlerts = async () => {
    try {
      const res = await fetch(weatherAlertsUrl);
      if (!res.ok) throw new Error("Failed to load alerts");
      const data = await res.json();
      alerts = (data.features || []).map((feature) => {
        const { event, areaDesc, effective } = feature.properties || {};
        return {
          event,
          area: areaDesc,
          time: effective || feature.properties?.sent,
        };
      });
      updateAlerts();
    } catch (err) {
      console.error(err);
      showError("Unable to load weather alerts right now.");
      alertList.innerHTML = "<li>Unable to load alerts.</li>";
    }
  };

  const fetchSolarFlares = async () => {
    try {
      const res = await fetch(solarFlaresUrl);
      if (!res.ok) throw new Error("Failed to load solar flares");
      const data = await res.json();
      flares = Array.isArray(data)
        ? data.map((item, idx) => ({
            id: item?.time_tag || `flare-${idx}`,
            flux: item?.flux,
            time: item?.time_tag,
          }))
        : [];
      updateFlares();
    } catch (err) {
      console.error(err);
      showError("Unable to load solar flare data right now.");
      flareList.innerHTML = "<li>Unable to load solar flares.</li>";
    }
  };

  const formatTime = (time) => {
    const date = new Date(time);
    return isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
  };

  const classifyFluxLevel = (value) => {
    if (!Number.isFinite(value)) return "Unknown";
    if (value >= 1e-4) return "X-class";
    if (value >= 1e-5) return "M-class";
    if (value >= 1e-6) return "C-class";
    if (value >= 1e-7) return "B-class";
    return "A-class";
  };

  const fluxColor = (value) => {
    if (!Number.isFinite(value)) return "rgba(96, 165, 250, 0.7)";
    if (value >= 1e-4) return "rgba(244, 114, 182, 0.9)";
    if (value >= 1e-5) return "rgba(248, 113, 113, 0.9)";
    if (value >= 1e-6) return "rgba(251, 191, 36, 0.9)";
    if (value >= 1e-7) return "rgba(52, 211, 153, 0.9)";
    return "rgba(96, 165, 250, 0.9)";
  };

  const highlightFlareListItem = (id) => {
    document.querySelectorAll("#flare-list li").forEach((n) => n.classList.remove("active"));
    if (!id) return;
    const target = document.querySelector(`#flare-list li[data-id="${id}"]`);
    if (target) {
      target.classList.add("active");
      target.scrollIntoView({ block: "nearest" });
    }
  };

  const updateEarthquakes = () => {
    const minMag = Number(minMagRange.value) || 0;
    minMagInput.value = minMag.toFixed(1);
    minMagValue.textContent = minMag.toFixed(1);

    let filtered = earthquakes.filter((q) => (q.mag ?? 0) >= minMag);
    filtered =
      sortSelect.value === "magnitude"
        ? filtered.sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0))
        : filtered.sort((a, b) => new Date(b.time) - new Date(a.time));
    const canRenderMap = mapReady && map && markersLayer;

    earthquakeList.innerHTML =
      filtered.length === 0 ? "<li>No earthquakes match the filter.</li>" : "";

    markerLookup.clear();
    if (canRenderMap) markersLayer.clearLayers();

    const frag = document.createDocumentFragment();
    filtered.forEach((q) => {
      const li = document.createElement("li");
      li.dataset.id = q.id;
      const isAftershock = highlightAftershocks.checked && (q.mag ?? 0) < 3.5;
      if (isAftershock) li.classList.add("aftershock");
      li.innerHTML = `<strong>M${q.mag?.toFixed(1) ?? "?"}</strong> - ${q.place || "Unknown location"}<div class="item-meta">${formatTime(q.time)}${q.depth !== undefined ? ` • Depth: ${(q.depth ?? 0).toFixed(1)} km` : ""}</div>`;
      li.addEventListener("click", () => focusMarker(q.id));
      frag.appendChild(li);

      if (canRenderMap && q.lat !== undefined && q.lon !== undefined) {
        const marker = L.marker([q.lat, q.lon]).addTo(markersLayer);
        marker.bindPopup(
          `<strong>M${q.mag?.toFixed(1) ?? "?"}</strong><br>${q.place || "Unknown location"}<br>${formatTime(q.time)}`
        );
        marker.on("click", () => highlightListItem(q.id));
        markerLookup.set(q.id, marker);
      }
    });
    earthquakeList.appendChild(frag);

    if (canRenderMap && markersLayer.getLayers().length) {
      map.invalidateSize();
      map.fitBounds(markersLayer.getBounds(), { padding: [30, 30] });
    }

    updateStats(filtered);
    updateSummary();
    refreshFeed();
  };

  const updateAlerts = () => {
    alertList.innerHTML =
      alerts.length === 0
        ? "<li>No active alerts.</li>"
        : alerts
            .map(
              (a) =>
                `<li><strong>${a.event || "Alert"}</strong> - ${a.area || "Unknown area"}<div class="item-meta">${formatTime(a.time)}</div></li>`
            )
            .join("");
    updateSummary();
    refreshFeed();
  };

  const updateFlares = () => {
    const sorted = flares
      .filter((f) => {
        const flux = Number(f.flux);
        return Number.isFinite(flux) && flux > 0;
      })
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 10);
    flareList.innerHTML =
      sorted.length === 0
        ? "<li>No flare data available.</li>"
        : sorted
            .map(
              (f) =>
                `<li data-id="${f.id}"><strong>${classifyFluxLevel(Number(f.flux))}</strong> — ${Number(f.flux).toExponential(2)} W/m²<div class="item-meta">${formatTime(f.time)}</div></li>`
            )
            .join("");
    document.querySelectorAll("#flare-list li[data-id]").forEach((li) =>
      li.addEventListener("click", () => highlightFlareListItem(li.dataset.id))
    );
    drawFlareChart();
    updateSummary();
    refreshFeed();
  };

  const updateSummary = () => {
    const maxMag =
      earthquakes.reduce((max, q) => (q.mag && q.mag > max ? q.mag : max), 0) ||
      0;
    const alertCount = alerts.length;
    const flarePeak =
      flares.reduce(
        (max, f) => (!Number.isNaN(Number(f.flux)) && Number(f.flux) > max ? Number(f.flux) : max),
        0
      ) || 0;

    const rows = [
      {
        metric: "Largest Magnitude",
        value: maxMag ? `M${maxMag.toFixed(1)}` : "n/a",
        status: maxMag >= 6 ? "Strong quake observed" : "Stable",
      },
      {
        metric: "Active Weather Alerts",
        value: alertCount,
        status: alertCount > 0 ? "Alerts in effect" : "Clear",
      },
      {
        metric: "Peak X-ray Flux",
        value: flarePeak ? `${flarePeak.toExponential(2)} W/m²` : "n/a",
        status: flarePeak > 0 ? "Solar flares detected" : "Calm",
      },
    ];

    summaryBody.innerHTML = rows
      .map(
        (row) =>
          `<tr><td>${row.metric}</td><td>${row.value}</td><td>${row.status}</td></tr>`
      )
      .join("");
  };

  const updateStats = (filtered) => {
    statTotal.textContent = filtered.length || 0;
    const strongest = filtered.reduce(
      (max, q) => ((q.mag ?? 0) > (max.mag ?? 0) ? q : max),
      {}
    );
    statStrongest.textContent =
      strongest && strongest.mag ? `M${strongest.mag.toFixed(1)}` : "--";
    statStrongestMeta.textContent = strongest.place
      ? `${strongest.place} • ${formatTime(strongest.time)}`
      : "Awaiting data.";
    const depthValues = filtered.filter((q) => q.depth !== undefined);
    const avgDepth =
      depthValues.reduce((sum, q) => sum + (q.depth ?? 0), 0) /
      (depthValues.length || 1);
    statDepth.textContent =
      depthValues.length > 0 && Number.isFinite(avgDepth)
        ? `${avgDepth.toFixed(1)} km`
        : "--";
  };

  const buildFeedEvents = () => {
    const eqEvents = earthquakes.slice(0, 20).map((q) => ({
      type: "earth",
      time: q.time,
      text: `M${q.mag?.toFixed(1) ?? "?"} quake - ${q.place || "Unknown"}`,
      target: "#earth",
    }));

    const alertEvents = alerts.slice(0, 15).map((a) => ({
      type: "weather",
      time: a.time,
      text: `${a.event || "Alert"} - ${a.area || "Unknown area"}`,
      target: "#earth",
    }));

    const flareEvents = flares.slice(0, 15).map((f) => ({
      type: "space",
      time: f.time,
      text: `Solar flare flux ${Number(f.flux).toExponential(2)} W/m²`,
      target: "#space",
    }));
    feedEvents = [...eqEvents, ...alertEvents, ...flareEvents]
      .filter((e) => e.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time));
  };

  const refreshFeed = () => {
    buildFeedEvents();
    if (feedIntervalId) clearInterval(feedIntervalId);
    feedList.innerHTML = "";
    let index = 0;

    const appendNext = () => {
      if (feedEvents.length === 0) {
        feedList.innerHTML = "<li>No live events available.</li>";
        return;
      }
      const event = feedEvents[index % feedEvents.length];
      const li = document.createElement("li");
      li.textContent = `${formatTime(event.time)} — ${event.text}`;
      li.dataset.target = event.target;
      li.addEventListener("click", () => {
        document.querySelectorAll("#feed-list li").forEach((n) => n.classList.remove("active"));
        li.classList.add("active");
        const target = document.querySelector(event.target);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      feedList.prepend(li);
      index += 1;
    };

    appendNext();
    feedIntervalId = setInterval(appendNext, 4000);
  };

  const auroraColor = (value) => {
    if (value >= 80) return "rgba(244, 114, 182, 0.8)";
    if (value >= 60) return "rgba(14, 165, 233, 0.8)";
    if (value >= 40) return "rgba(52, 211, 153, 0.75)";
    if (value >= 20) return "rgba(190, 242, 100, 0.7)";
    return "rgba(148, 163, 184, 0.6)";
  };

  const normalizeAuroraData = (raw) => {
    const points = [];
    const pushPoint = (lat, lon, value) => {
      const latNum = Number(lat);
      const lonNum = Number(lon);
      const valNum = Number(value);
      if (
        Number.isFinite(latNum) &&
        Number.isFinite(lonNum) &&
        Number.isFinite(valNum) &&
        Math.abs(latNum) <= 90 &&
        Math.abs(lonNum) <= 180 &&
        valNum >= 0
      ) {
        points.push({ lat: latNum, lon: lonNum, value: valNum });
      }
    };

    if (Array.isArray(raw)) {
      raw.forEach((item) => {
        if (Array.isArray(item)) {
          const [a, b, c] = item;
          const latFirst = Math.abs(a) <= 90 && Math.abs(b) <= 180;
          const lat = latFirst ? a : b;
          const lon = latFirst ? b : a;
          pushPoint(lat, lon, c);
        } else if (item && typeof item === "object") {
          pushPoint(
            item.lat ?? item.latitude ?? item[1],
            item.lon ?? item.longitude ?? item[0],
            item.probability ?? item.prob ?? item.value ?? item.intensity ?? item[2]
          );
        }
      });
      return points;
    }

    const coords = raw?.coordinates;
    const intensity = raw?.intensity || raw?.data || raw?.values || raw?.probability;
    if (Array.isArray(coords) && Array.isArray(intensity) && coords.length === intensity.length) {
      intensity.forEach((val, idx) => {
        const coord = coords[idx];
        if (Array.isArray(coord)) {
          const [lon, lat] = coord.length >= 2 ? coord : [coord[0], coord[1]];
          pushPoint(lat, lon, val);
        } else if (coord && typeof coord === "object") {
          pushPoint(coord.lat ?? coord.latitude, coord.lon ?? coord.longitude, val);
        }
      });
      return points;
    }

    if (
      raw &&
      Array.isArray(raw.latitudes) &&
      Array.isArray(raw.longitudes) &&
      Array.isArray(raw.data)
    ) {
      raw.latitudes.forEach((lat, i) => {
        const row = raw.data[i];
        if (!Array.isArray(row)) return;
        row.forEach((val, j) => {
          const lon = raw.longitudes[j];
          pushPoint(lat, lon, val);
        });
      });
      return points;
    }

    if (raw && Array.isArray(raw.features)) {
      raw.features.forEach((feature) => {
        const val =
          feature.properties?.probability ??
          feature.properties?.intensity ??
          feature.properties?.value ??
          feature.properties?.amp ??
          0;
        const coordsSet = feature.geometry?.coordinates;
        if (Array.isArray(coordsSet)) {
          const flattenCoords = coordsSet.flat(2);
          for (let i = 0; i < flattenCoords.length; i += 2) {
            const lon = flattenCoords[i];
            const lat = flattenCoords[i + 1];
            pushPoint(lat, lon, val);
          }
        }
      });
      return points;
    }

    return points;
  };

  const renderAuroraLayer = () => {
    if (!auroraMap || !window.L) {
      setAuroraStatus("Aurora map unavailable right now.", true);
      return;
    }
    if (auroraHeatLayer) {
      auroraHeatLayer.remove();
      auroraHeatLayer = null;
    }
    if (auroraLayer) {
      auroraLayer.remove();
      auroraLayer = null;
    }
    const usable = [...auroraPoints]
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 2000);

    if (!usable.length) {
      setAuroraStatus("No aurora data available right now.", true);
      return;
    }
    setAuroraStatus(auroraUsingFallback ? "Showing fallback aurora sample." : "");

    if (window.L.heatLayer) {
      const heatData = usable.map((p) => [p.lat, p.lon, Math.min(1, p.value / 100)]);
      auroraHeatLayer = L.heatLayer(heatData, {
        radius: 20,
        blur: 26,
        maxZoom: 6,
        minOpacity: 0.25,
        gradient: {
          0.0: "#0ea5e9",
          0.25: "#34d399",
          0.5: "#bef264",
          0.75: "#f472b6",
          1.0: "#f472b6",
        },
      }).addTo(auroraMap);
    } else {
      // Fallback markers when heat plugin isn't available.
      auroraLayer = L.featureGroup().addTo(auroraMap);
      usable.forEach((p) => {
        const radius = Math.max(4, Math.min(18, p.value / 6));
        L.circleMarker([p.lat, p.lon], {
          radius,
          color: "#f472b6",
          fillColor: "#f472b6",
          fillOpacity: Math.min(0.85, p.value / 100),
          weight: 1,
        })
          .bindPopup(`Aurora probability: ${Math.round(p.value)}%`)
          .addTo(auroraLayer);
      });
    }

    const bounds = L.latLngBounds(usable.map((p) => [p.lat, p.lon]));
    auroraMap.fitBounds(bounds, { padding: [20, 20], maxZoom: 5 });
    setTimeout(() => auroraMap.invalidateSize(), 80);
  };

  const fetchAurora = async () => {
    if (!auroraMapEl) return;
    try {
      setAuroraStatus("Loading aurora map...");
      let parsed = null;
      let errors = [];
      for (const source of auroraSources) {
        try {
          parsed = await fetchJson(source.url, source.parse);
          break;
        } catch (err) {
          errors.push({ source: source.label, error: err.message || err });
          if (console?.debug) {
            console.debug(`Aurora source failed (${source.label}), trying next.`, err.message || err);
          }
        }
      }
      auroraPoints = normalizeAuroraData(parsed);
      auroraUsingFallback = false;
      if (!auroraPoints.length && auroraInlineFallback.length) {
        auroraPoints = normalizeAuroraData(auroraInlineFallback);
        auroraUsingFallback = true;
      }
      if (!auroraPoints.length && window.location.protocol !== "file:") {
        try {
          const fallback = await fetchJson("./assets/aurora-fallback.json");
          auroraPoints = normalizeAuroraData(fallback);
          auroraUsingFallback = true;
        } catch (fallbackErr) {
          errors.push({ source: "local-fallback-force", error: fallbackErr.message || fallbackErr });
        }
      }
      if (!auroraPoints.length) {
        throw new Error(`No aurora data parsed. Tried: ${errors.map((e) => e.source).join(", ")}`);
      }
      setAuroraStatus("");
      renderAuroraLayer();
    } catch (err) {
      console.error(err);
      setAuroraStatus("Aurora data unavailable right now.", true);
    }
  };

  const drawFlareChart = () => {
    if (!flareChartEl || !window.Chart) return;
    const sorted = flares
      .filter((f) => {
        const flux = Number(f.flux);
        return Number.isFinite(flux) && flux > 0;
      })
      .sort((a, b) => new Date(a.time) - new Date(b.time))
      .slice(-50);
    const labels = sorted.map((f) => formatTime(f.time));
    const data = sorted.map((f) => Number(f.flux));

    const flareBands = [
      { label: "X", min: 1e-4, max: 1e-2, color: "rgba(244, 114, 182, 0.08)" },
      { label: "M", min: 1e-5, max: 1e-4, color: "rgba(248, 113, 113, 0.08)" },
      { label: "C", min: 1e-6, max: 1e-5, color: "rgba(251, 191, 36, 0.07)" },
      { label: "B", min: 1e-7, max: 1e-6, color: "rgba(52, 211, 153, 0.07)" },
      { label: "A", min: 1e-9, max: 1e-7, color: "rgba(59, 130, 246, 0.06)" },
    ];

    const bandPlugin = {
      id: "flareBands",
      beforeDraw: (chart) => {
        const opts = chart.options.plugins?.flareBands;
        if (!opts?.bands || !chart.scales?.y) return;
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        ctx.save();
        const yScale = chart.scales.y;
        const clamp = (val) => {
          const min = yScale.min ?? 1e-9;
          const max = yScale.max ?? 1;
          return Math.min(Math.max(val, min), max);
        };
        opts.bands.forEach((band) => {
          const yTop = yScale.getPixelForValue(clamp(band.max));
          const yBottom = yScale.getPixelForValue(clamp(band.min));
          const top = Math.min(yTop, yBottom);
          const height = Math.max(yTop, yBottom) - top;
          ctx.fillStyle = band.color;
          ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, height);
        });
        ctx.restore();
      },
    };

    if (!labels.length) {
      if (flareChart) {
        flareChart.destroy();
        flareChart = null;
      }
      return;
    }

    const ids = sorted.map((f) => f.id);

    const maxFlux = Math.max(...data);
    const minFlux = Math.max(Math.min(...data), 1e-9);
    const yMin = Math.max(1e-9, minFlux / 3);
    const yMax = maxFlux ? maxFlux * 1.6 : 1e-5;

    if (flareChart) flareChart.destroy();

    flareChart = new Chart(flareChartEl, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "X-ray Flux (W/m²)",
            data,
            backgroundColor: data.map((v) => fluxColor(v)),
            borderColor: data.map((v) => fluxColor(v)),
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
            barPercentage: 0.9,
            categoryPercentage: 0.9,
            hoverBackgroundColor: data.map((v) => fluxColor(v)),
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          flareBands: { bands: flareBands },
          legend: { labels: { color: "#e2e8f0" } },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ` ${ctx.parsed.y.toExponential(2)} W/m² (${classifyFluxLevel(ctx.parsed.y)})`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#94a3b8", maxTicksLimit: 6 },
            grid: { color: "rgba(148, 163, 184, 0.15)" },
          },
          y: {
            type: "logarithmic",
            min: yMin,
            max: yMax,
            ticks: {
              color: "#94a3b8",
              callback: (v) => Number(v).toExponential(1),
            },
            grid: { color: "rgba(148, 163, 184, 0.15)" },
          },
        },
        interaction: { mode: "nearest", intersect: true },
        onHover: (evt, elements) => {
          if (!evt?.native?.target) return;
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
          if (elements.length) {
            const idx = elements[0].index;
            const id = ids[idx];
            highlightFlareListItem(id);
          }
        },
        onClick: (_, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const id = ids[idx];
          highlightFlareListItem(id);
        },
      },
      plugins: [bandPlugin],
    });
  };

  const handleFilters = (e) => {
    e.preventDefault();
    const mag = Number(minMagInput.value) || 0;
    minMagRange.value = mag;
    updateEarthquakes();
    const mode = modeSelect.value;
    if (mode === "earth") toggleMode("earth");
    if (mode === "space") toggleMode("space");
    if (mode === "all") toggleMode("overview");
  };

  const toggleMode = (mode) => {
    Object.keys(sections).forEach((key) => {
      if (mode === "overview") {
        sections[key].classList.remove("hidden");
      } else if (key === mode) {
        sections[key].classList.remove("hidden");
      } else {
        sections[key].classList.add("hidden");
      }
    });
  };

  const initModeButtons = () => {
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        toggleMode(mode);
      });
    });
  };

  const initAuroraMap = async () => {
    if (auroraMap || !auroraMapEl) return;
    try {
      setAuroraStatus("Loading aurora map...");
      await Promise.all([ensureLeafletLoaded(), ensureLeafletHeatLoaded()]);
      auroraMap = L.map("aurora-map", { worldCopyJump: true }).setView([60, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(auroraMap);
      setAuroraStatus("");
      setTimeout(() => auroraMap.invalidateSize(), 50);
    } catch (err) {
      console.error(err);
      setAuroraStatus("Aurora map unavailable right now.", true);
    }
  };

  const initMap = async () => {
    if (map) return;
    try {
      setMapStatus("Loading map...");
      await ensureLeafletLoaded();
      map = L.map("map").setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      markersLayer = L.featureGroup().addTo(map);
      mapReady = true;
      setMapStatus("");
      setTimeout(() => map.invalidateSize(), 50);
    } catch (err) {
      console.error(err);
      mapReady = false;
      setMapStatus("Map unavailable right now. Check your connection.", true);
    }
  };

  const highlightListItem = (id) => {
    document
      .querySelectorAll("#earthquake-list li")
      .forEach((n) => n.classList.remove("active"));
    const target = document.querySelector(`#earthquake-list li[data-id="${id}"]`);
    if (target) {
      target.classList.add("active");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const focusMarker = (id) => {
    const marker = markerLookup.get(id);
    if (marker) {
      marker.openPopup();
      highlightListItem(id);
      map.panTo(marker.getLatLng());
    }
  };

  const setAutoRefresh = (enabled) => {
    if (autoRefreshId) clearInterval(autoRefreshId);
    if (enabled) {
      autoRefreshId = setInterval(() => fetchEarthquakes(currentWindow), 60000);
    }
  };

  const initControls = () => {
    minMagRange.addEventListener("input", updateEarthquakes);
    timeWindowRadios.forEach((radio) =>
      radio.addEventListener("change", (e) => fetchEarthquakes(e.target.value))
    );
    sortSelect.addEventListener("change", updateEarthquakes);
    highlightAftershocks.addEventListener("change", updateEarthquakes);
    autoRefreshCheckbox.addEventListener("change", (e) =>
      setAutoRefresh(e.target.checked)
    );
  };

  const initWeather = () => {
    if (!weatherForm || !weatherQueryInput) return;
    weatherForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const query = weatherQueryInput.value.trim();
      if (!query) {
        setWeatherStatus("Enter a city, region, or coordinates.", true);
        return;
      }
      loadWeatherForQuery(query);
    });
    if (defaultWeatherQuery) {
      loadWeatherForQuery(defaultWeatherQuery);
    }
  };

  const init = async () => {
    initTheme();
    initWeatherAssistantLink();
    smoothNav();
    initModeButtons();
    initControls();
    initWeather();
    filtersForm.addEventListener("submit", handleFilters);
    await initMap();
    await initAuroraMap();
    try {
      await ensureChartJsLoaded();
    } catch (err) {
      console.warn("Chart.js failed to load, continuing without charts.", err);
      showError("Charts are unavailable right now, but live data will continue to load.");
    }
    await Promise.all([
      fetchEarthquakes(),
      fetchWeatherAlerts(),
      fetchSolarFlares(),
      fetchAurora(),
    ]);
    updateSummary();
  };

  init();
});
