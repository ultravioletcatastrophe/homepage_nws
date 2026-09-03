(() => {
  "use strict";

  const NAMESPACE = "homepage-nws-weather";
  const VERSION = "0.1.4";

  if (window.__homepageNwsWeather) {
    return;
  }

  window.__homepageNwsWeather = true;

  const userConfig = window.HOMEPAGE_NWS_WEATHER || {};
  const scriptUrl = document.currentScript?.src || window.location.href;
  const latitude = Number(userConfig.latitude);
  const longitude = Number(userConfig.longitude);
  const hasCoordinates =
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;
  const hasEndpointOverrides = Boolean(userConfig.forecastUrl && userConfig.hourlyUrl);

  if (!hasCoordinates && !hasEndpointOverrides) {
    console.error(`[${NAMESPACE}] Set valid latitude and longitude values before loading the widget.`);
    return;
  }

  function atLeast(value, fallback, minimum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(number, minimum) : fallback;
  }

  function validTimeZone(value) {
    if (!value) {
      return null;
    }

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return value;
    } catch {
      return null;
    }
  }

  const configuredTimeZone = validTimeZone(userConfig.timeZone);

  const locationKey = hasCoordinates ? `${latitude.toFixed(4)},${longitude.toFixed(4)}` : "custom";
  const units = userConfig.units === "si" ? "si" : "us";
  const CONFIG = {
    latitude,
    longitude,
    units,
    locationLabel: userConfig.locationLabel || "Local weather",
    targetSelector: userConfig.targetSelector || "#information-widgets-right",
    position: ["start", "center", "end"].includes(userConfig.position) ? userConfig.position : "center",
    linkTarget: userConfig.linkTarget || "_blank",
    spriteUrl: userConfig.spriteUrl || new URL(`weather-icons.png?v=${VERSION}`, scriptUrl).href,
    forecastUrl: userConfig.forecastUrl || null,
    hourlyUrl: userConfig.hourlyUrl || null,
    timeZone: configuredTimeZone || validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC",
    detailsUrl:
      userConfig.detailsUrl ||
      (hasCoordinates
        ? `https://forecast.weather.gov/MapClick.php?lat=${latitude}&lon=${longitude}`
        : "https://www.weather.gov/"),
    background: userConfig.background || "#eaf7fb",
    border: userConfig.border || "#367b98",
    text: userConfig.text || "#173652",
    refreshMs: atLeast(userConfig.refreshMinutes, 30, 5) * 60 * 1000,
    retryMs: atLeast(userConfig.retryMinutes, 5, 1) * 60 * 1000,
    timeoutMs: atLeast(userConfig.requestTimeoutSeconds, 75, 5) * 1000,
    endpointCacheMs: atLeast(userConfig.endpointCacheDays, 7, 1) * 24 * 60 * 60 * 1000,
    weatherCacheMs: atLeast(userConfig.weatherCacheMinutes, 360, 15) * 60 * 1000,
    endpointCacheKey: `${NAMESPACE}:endpoints:${locationKey}:v1`,
    weatherCacheKey: `${NAMESPACE}:forecast:${locationKey}:${units}:v1`,
  };

  const state = {
    data: null,
    locationLabel: CONFIG.locationLabel,
    timeZone: CONFIG.timeZone,
    refreshTimer: null,
    solarTimer: null,
  };

  function addStyles() {
    if (document.getElementById(`${NAMESPACE}-styles`)) {
      return;
    }

    const style = document.createElement("style");
    style.id = `${NAMESPACE}-styles`;
    style.textContent = `
      #${NAMESPACE} {
        align-items: center;
        background: var(--homepage-nws-background);
        border: 1px solid var(--homepage-nws-border);
        border-radius: 0.5rem;
        color: var(--homepage-nws-text);
        display: flex;
        flex: 0 0 auto;
        gap: 0.65rem;
        min-height: 3.25rem;
        padding: 0.3rem 0.95rem 0.3rem 0.65rem;
        text-decoration: none;
      }

      #${NAMESPACE}[data-position="start"] {
        margin-left: 0;
        margin-right: auto;
      }

      #${NAMESPACE}[data-position="center"] {
        margin-left: auto;
        margin-right: auto;
      }

      #${NAMESPACE}[data-position="end"] {
        margin-left: auto;
        margin-right: 0;
      }

      #${NAMESPACE}:focus-visible {
        outline: 1px solid var(--homepage-nws-border);
        outline-offset: 4px;
      }

      .homepage-nws-weather__icon {
        background-repeat: no-repeat;
        background-size: 400% 300%;
        flex: 0 0 auto;
      }

      .homepage-nws-weather__icon[data-icon="clear-day"] {
        background-position: 0% 0%;
      }

      .homepage-nws-weather__icon[data-icon="clear-night"] {
        background-position: 33.333% 0%;
      }

      .homepage-nws-weather__icon[data-icon="partly-day"] {
        background-position: 66.667% 0%;
      }

      .homepage-nws-weather__icon[data-icon="partly-night"] {
        background-position: 100% 0%;
      }

      .homepage-nws-weather__icon[data-icon="cloudy"] {
        background-position: 0% 50%;
      }

      .homepage-nws-weather__icon[data-icon="rain"] {
        background-position: 33.333% 50%;
      }

      .homepage-nws-weather__icon[data-icon="thunder"] {
        background-position: 66.667% 50%;
      }

      .homepage-nws-weather__icon[data-icon="snow"] {
        background-position: 100% 50%;
      }

      .homepage-nws-weather__icon[data-icon="fog"] {
        background-position: 0% 100%;
      }

      .homepage-nws-weather__icon[data-icon="humidity"] {
        background-position: 33.333% 100%;
      }

      .homepage-nws-weather__icon[data-icon="precipitation"] {
        background-position: 66.667% 100%;
      }

      .homepage-nws-weather__icon[data-icon="wind"] {
        background-position: 100% 100%;
      }

      .homepage-nws-weather__art {
        height: 3rem;
        width: 3rem;
      }

      .homepage-nws-weather__summary {
        min-width: 3.375rem;
      }

      .homepage-nws-weather__temperature {
        display: block;
        font-size: 1.15rem;
        font-weight: 500;
        line-height: 1.1;
        white-space: nowrap;
      }

      .homepage-nws-weather__range {
        display: block;
        font-size: 0.68rem;
        font-weight: 400;
        line-height: 1.2;
        margin-top: 0.1rem;
        opacity: 0.62;
        white-space: nowrap;
      }

      .homepage-nws-weather__metrics {
        align-items: start;
        display: flex;
        gap: 0.36rem;
      }

      .homepage-nws-weather__metric {
        align-items: center;
        display: flex;
        flex-direction: column;
        font-size: 0.67rem;
        gap: 0.1rem;
        line-height: 1;
        min-width: 2.35rem;
        opacity: 0.76;
        white-space: nowrap;
      }

      .homepage-nws-weather__metric-icon {
        height: 1.3rem;
        width: 1.3rem;
      }

      .homepage-nws-weather__metric-svg {
        display: block;
        overflow: visible;
      }

      .homepage-nws-weather__solar-icon[data-event="sunrise"] [data-event="sunset"],
      .homepage-nws-weather__solar-icon[data-event="sunset"] [data-event="sunrise"] {
        display: none;
      }

      @media (max-width: 767px) {
        #${NAMESPACE} {
          margin: 0.5rem auto 0.2rem;
          padding: 0.3rem 0.85rem 0.3rem 0.55rem;
        }

        .homepage-nws-weather__summary {
          min-width: 3.375rem;
        }

        .homepage-nws-weather__metrics {
          gap: 0.2rem;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createWidget() {
    const root = document.createElement("a");
    root.id = NAMESPACE;
    root.href = CONFIG.detailsUrl;
    root.target = CONFIG.linkTarget;
    root.dataset.position = CONFIG.position;
    root.dataset.status = "loading";
    root.style.setProperty("--homepage-nws-background", CONFIG.background);
    root.style.setProperty("--homepage-nws-border", CONFIG.border);
    root.style.setProperty("--homepage-nws-text", CONFIG.text);
    root.setAttribute("aria-label", `${CONFIG.locationLabel} weather loading`);

    if (CONFIG.linkTarget === "_blank") {
      root.rel = "noreferrer";
    }

    root.innerHTML = `
      <span class="homepage-nws-weather__icon homepage-nws-weather__art" data-role="condition-icon" data-icon="partly-day" aria-hidden="true"></span>
      <span class="homepage-nws-weather__summary">
        <span class="homepage-nws-weather__temperature" data-role="temperature">--°</span>
        <span class="homepage-nws-weather__range">
          <span data-role="high">--°</span> / <span data-role="low">--°</span>
        </span>
      </span>
      <span class="homepage-nws-weather__metrics">
        <span class="homepage-nws-weather__metric" data-role="solar-wrap">
          <svg class="homepage-nws-weather__metric-icon homepage-nws-weather__metric-svg homepage-nws-weather__solar-icon" data-role="solar-icon" data-event="sunrise" viewBox="0 0 48 48" aria-hidden="true">
            <g fill="none" stroke="#163d70" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
              <path d="M24 4v4M10.5 9.5l3 3M37.5 9.5l-3 3M5 23h4M39 23h4"></path>
              <circle cx="24" cy="23" r="10" fill="#ffd42a"></circle>
              <path data-event="sunrise" d="M24 42V23M17.5 29.5 24 23l6.5 6.5" stroke-width="2.6"></path>
              <path data-event="sunset" d="M24 23v19M17.5 35.5 24 42l6.5-6.5" stroke-width="2.6"></path>
            </g>
          </svg>
          <span data-role="solar-time">--</span>
        </span>
        <span class="homepage-nws-weather__metric" data-role="humidity-wrap">
          <svg class="homepage-nws-weather__metric-icon homepage-nws-weather__metric-svg" viewBox="0 0 48 48" aria-hidden="true">
            <defs>
              <linearGradient id="homepage-nws-humidity-fill" x1="12" y1="8" x2="37" y2="41" gradientUnits="userSpaceOnUse">
                <stop stop-color="#f7fbff"></stop>
                <stop offset="1" stop-color="#8fdcf2"></stop>
              </linearGradient>
            </defs>
            <path d="M24 4.5C20.2 10.4 11.5 21.1 11.5 30.1a12.5 12.5 0 0 0 25 0C36.5 21.1 27.8 10.4 24 4.5Z" fill="url(#homepage-nws-humidity-fill)" stroke="#163d70" stroke-width="2"></path>
            <circle cx="20" cy="27" r="2.2" fill="none" stroke="#163d70" stroke-width="1.8"></circle>
            <circle cx="28" cy="34" r="2.2" fill="none" stroke="#163d70" stroke-width="1.8"></circle>
            <path d="m19.5 35 9-10" fill="none" stroke="#163d70" stroke-linecap="round" stroke-width="1.8"></path>
          </svg>
          <span data-role="humidity">--%</span>
        </span>
        <span class="homepage-nws-weather__metric" data-role="precipitation-wrap">
          <span class="homepage-nws-weather__icon homepage-nws-weather__metric-icon" data-icon="precipitation" aria-hidden="true"></span>
          <span data-role="precipitation">--%</span>
        </span>
        <span class="homepage-nws-weather__metric" data-role="wind-wrap">
          <svg class="homepage-nws-weather__metric-icon homepage-nws-weather__metric-svg" viewBox="0 0 48 48" aria-hidden="true">
            <defs>
              <clipPath id="homepage-nws-windsock-clip">
                <path d="M14 9c8.8 0 17 2.2 25 6.6l-4 10.2c-7.1-3.6-14-5.1-21-4.7Z"></path>
              </clipPath>
            </defs>
            <path d="M14 9c8.8 0 17 2.2 25 6.6l-4 10.2c-7.1-3.6-14-5.1-21-4.7Z" fill="#f7fbff"></path>
            <g clip-path="url(#homepage-nws-windsock-clip)" fill="#ff7657">
              <path d="M13 7h9l-1.5 16H13Z"></path>
              <path d="m29 10 8 2.7-3.8 14.4-7.4-2.7Z"></path>
            </g>
            <path d="M14 9c8.8 0 17 2.2 25 6.6l-4 10.2c-7.1-3.6-14-5.1-21-4.7Z" fill="none" stroke="#163d70" stroke-linejoin="round" stroke-width="2"></path>
            <path d="M14 8v33M8.5 41h11" fill="none" stroke="#163d70" stroke-linecap="round" stroke-width="2"></path>
          </svg>
          <span data-role="wind">--</span>
        </span>
      </span>
    `;

    root.querySelectorAll(".homepage-nws-weather__icon").forEach((icon) => {
      icon.style.backgroundImage = `url(${JSON.stringify(CONFIG.spriteUrl)})`;
    });
    return root;
  }

  function ensureMounted() {
    const target = document.querySelector(CONFIG.targetSelector);

    if (!target) {
      return false;
    }

    let root = document.getElementById(NAMESPACE);

    if (!root) {
      root = createWidget();
      target.prepend(root);

      if (state.data) {
        render(state.data);
      }
    }

    return true;
  }

  function role(name) {
    return document.querySelector(`#${NAMESPACE} [data-role="${name}"]`);
  }

  function setText(name, value) {
    const element = role(name);

    if (element) {
      element.textContent = value;
    }
  }

  function chooseIcon(period) {
    const text = `${period.shortForecast || ""} ${period.detailedForecast || ""}`.toLowerCase();

    if (/snow|sleet|ice pellets|blizzard/.test(text)) {
      return "snow";
    }

    if (/thunder|lightning/.test(text)) {
      return "thunder";
    }

    if (/rain|shower|drizzle/.test(text)) {
      return "rain";
    }

    if (/fog|haze|mist|smoke/.test(text)) {
      return "fog";
    }

    if (/overcast|cloudy/.test(text) && !/partly|mostly sunny|mostly clear/.test(text)) {
      return "cloudy";
    }

    if (/partly|mostly sunny|mostly clear|few clouds/.test(text)) {
      return period.isDaytime ? "partly-day" : "partly-night";
    }

    return period.isDaytime ? "clear-day" : "clear-night";
  }

  function datePartsInTimeZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));

    return {
      year: values.year,
      month: values.month,
      day: values.day,
    };
  }

  function solarEventsForDate(year, month, day) {
    const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
    const fractionalYear = (2 * Math.PI * (dayOfYear - 1)) / 365;
    const equationOfTime =
      229.18 *
      (0.000075 +
        0.001868 * Math.cos(fractionalYear) -
        0.032077 * Math.sin(fractionalYear) -
        0.014615 * Math.cos(2 * fractionalYear) -
        0.040849 * Math.sin(2 * fractionalYear));
    const declination =
      0.006918 -
      0.399912 * Math.cos(fractionalYear) +
      0.070257 * Math.sin(fractionalYear) -
      0.006758 * Math.cos(2 * fractionalYear) +
      0.000907 * Math.sin(2 * fractionalYear) -
      0.002697 * Math.cos(3 * fractionalYear) +
      0.00148 * Math.sin(3 * fractionalYear);
    const latitudeRadians = (latitude * Math.PI) / 180;
    const zenithRadians = (90.833 * Math.PI) / 180;
    const hourAngleCosine =
      Math.cos(zenithRadians) / (Math.cos(latitudeRadians) * Math.cos(declination)) -
      Math.tan(latitudeRadians) * Math.tan(declination);

    if (hourAngleCosine < -1 || hourAngleCosine > 1) {
      return { sunrise: null, sunset: null };
    }

    const hourAngle = (Math.acos(hourAngleCosine) * 180) / Math.PI;
    const midnightUtc = Date.UTC(year, month - 1, day);
    const atUtcMinutes = (minutes) => new Date(midnightUtc + minutes * 60000);

    return {
      sunrise: atUtcMinutes(720 - 4 * (longitude + hourAngle) - equationOfTime),
      sunset: atUtcMinutes(720 - 4 * (longitude - hourAngle) - equationOfTime),
    };
  }

  function nextSolarEvent(now = new Date()) {
    if (!hasCoordinates) {
      return null;
    }

    const localDate = datePartsInTimeZone(now, state.timeZone);
    const firstDate = Date.UTC(localDate.year, localDate.month - 1, localDate.day);
    const format = new Intl.DateTimeFormat([], {
      timeZone: state.timeZone,
      hour: "numeric",
      minute: "2-digit",
    });

    for (let offset = 0; offset <= 370; offset += 1) {
      const candidateDate = new Date(firstDate + offset * 86400000);
      const events = solarEventsForDate(
        candidateDate.getUTCFullYear(),
        candidateDate.getUTCMonth() + 1,
        candidateDate.getUTCDate(),
      );
      const next = [
        events.sunrise && { type: "sunrise", date: events.sunrise },
        events.sunset && { type: "sunset", date: events.sunset },
      ]
        .filter((event) => event && event.date > now)
        .sort((a, b) => a.date - b.date)[0];

      if (next) {
        return {
          ...next,
          time: format.format(next.date),
        };
      }
    }

    return null;
  }

  function normalize(forecast, hourly) {
    const forecastPeriods = forecast?.properties?.periods || [];
    const hourlyPeriod = hourly?.properties?.periods?.[0] || forecastPeriods[0];

    if (!hourlyPeriod || forecastPeriods.length === 0) {
      throw new Error("NWS returned no forecast periods");
    }

    const candidates = forecastPeriods.slice(0, 4);
    const daytime = candidates.find((period) => period.isDaytime);
    const nighttime = candidates.find((period) => !period.isDaytime);
    const temperatures = [daytime?.temperature, nighttime?.temperature].filter(Number.isFinite);
    const temperature = hourlyPeriod.temperature;

    if (!Number.isFinite(temperature)) {
      throw new Error("NWS returned no current temperature");
    }

    if (temperatures.length === 0) {
      throw new Error("NWS returned no temperatures");
    }

    const humidity = hourlyPeriod.relativeHumidity?.value;
    const precipitation = hourlyPeriod.probabilityOfPrecipitation?.value;
    const wind = [hourlyPeriod.windDirection, hourlyPeriod.windSpeed].filter(Boolean).join(" ");

    return {
      condition: hourlyPeriod.shortForecast || forecastPeriods[0].shortForecast || state.locationLabel,
      detailedForecast: forecastPeriods[0].detailedForecast || "",
      temperature,
      high: Math.max(...temperatures),
      low: Math.min(...temperatures),
      temperatureUnit: hourlyPeriod.temperatureUnit || daytime?.temperatureUnit || nighttime?.temperatureUnit || "F",
      humidity: Number.isFinite(humidity) ? Math.round(humidity) : null,
      precipitation: Number.isFinite(precipitation) ? Math.round(precipitation) : null,
      wind: wind || "Calm",
      icon: chooseIcon(hourlyPeriod),
      updatedAt: Date.now(),
    };
  }

  function render(data, stale = false) {
    const root = document.getElementById(NAMESPACE);

    if (!root) {
      return;
    }

    const solarEvent = data.solarEvent || nextSolarEvent();

    setText("temperature", `${data.temperature}°`);
    setText("high", `${data.high}°`);
    setText("low", `${data.low}°`);
    setText("humidity", data.humidity === null ? "--" : `${data.humidity}%`);
    setText("precipitation", data.precipitation === null ? "--" : `${data.precipitation}%`);
    setText("wind", data.wind);
    setText("solar-time", solarEvent?.time || "--");

    const icon = role("condition-icon");

    if (icon) {
      icon.dataset.icon = data.icon;
    }

    const solarIcon = role("solar-icon");
    const solarWrap = role("solar-wrap");

    if (solarIcon && solarEvent) {
      solarIcon.dataset.event = solarEvent.type;
    }

    if (solarWrap) {
      solarWrap.hidden = !solarEvent;
    }

    const unitName = data.temperatureUnit === "C" ? "Celsius" : "Fahrenheit";
    const updated = new Date(data.updatedAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    const solarSummary = solarEvent ? ` Next ${solarEvent.type} at ${solarEvent.time}.` : "";
    const summary = `${state.locationLabel} weather: ${data.condition}. Current temperature ${data.temperature} degrees ${unitName}. High ${data.high} degrees ${unitName}, low ${data.low} degrees ${unitName}. Humidity ${data.humidity ?? "unavailable"} percent. Precipitation ${data.precipitation ?? "unavailable"} percent. Wind ${data.wind}.${solarSummary}`;
    const title = [
      data.detailedForecast,
      `${stale ? "Cached NWS forecast from" : "NWS forecast updated"} ${updated}`,
    ]
      .filter(Boolean)
      .join("\n");

    root.dataset.status = stale ? "stale" : "current";
    root.setAttribute("aria-label", summary);
    root.title = title;
    role("humidity-wrap")?.setAttribute("title", `Humidity ${data.humidity ?? "unavailable"}%`);
    role("precipitation-wrap")?.setAttribute("title", `Precipitation ${data.precipitation ?? "unavailable"}%`);
    role("wind-wrap")?.setAttribute("title", `Wind ${data.wind}`);
    solarWrap?.setAttribute("title", solarEvent ? `Next ${solarEvent.type} ${solarEvent.time}` : "");

    window.clearTimeout(state.solarTimer);

    if (solarEvent?.date) {
      const delay = Math.min(Math.max(solarEvent.date - Date.now() + 1000, 1000), 2147483647);
      state.solarTimer = window.setTimeout(() => render(data, stale), delay);
    }
  }

  function readStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The widget still works when local storage is disabled.
    }
  }

  function readWeatherCache() {
    const cached = readStorage(CONFIG.weatherCacheKey);

    if (
      Number.isFinite(cached?.temperature) &&
      Number.isFinite(cached?.high) &&
      Number.isFinite(cached?.low) &&
      Date.now() - cached.updatedAt <= CONFIG.weatherCacheMs
    ) {
      return cached;
    }

    return null;
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/geo+json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}: ${url}`);
      }

      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function withUnits(url) {
    const parsed = new URL(url, window.location.href);

    if (parsed.hostname === "api.weather.gov") {
      parsed.searchParams.set("units", CONFIG.units);
    }

    return parsed.toString();
  }

  function locationFromPoint(point) {
    const location = point?.properties?.relativeLocation?.properties;

    if (!location?.city) {
      return null;
    }

    return [location.city, location.state].filter(Boolean).join(", ");
  }

  async function resolveEndpoints() {
    if (CONFIG.forecastUrl && CONFIG.hourlyUrl) {
      return {
        forecast: CONFIG.forecastUrl,
        hourly: CONFIG.hourlyUrl,
      };
    }

    const cached = readStorage(CONFIG.endpointCacheKey);

    if (
      cached?.forecast &&
      cached?.hourly &&
      (configuredTimeZone || validTimeZone(cached.timeZone)) &&
      Date.now() - cached.updatedAt <= CONFIG.endpointCacheMs
    ) {
      state.locationLabel = userConfig.locationLabel || cached.locationLabel || state.locationLabel;
      state.timeZone = configuredTimeZone || validTimeZone(cached.timeZone) || state.timeZone;
      return cached;
    }

    try {
      const point = await fetchJson(`https://api.weather.gov/points/${CONFIG.latitude},${CONFIG.longitude}`);
      const endpoints = {
        forecast: point?.properties?.forecast,
        hourly: point?.properties?.forecastHourly,
        locationLabel: locationFromPoint(point),
        timeZone: validTimeZone(point?.properties?.timeZone),
        updatedAt: Date.now(),
      };

      if (!endpoints.forecast || !endpoints.hourly) {
        throw new Error("NWS point metadata did not include forecast endpoints");
      }

      state.locationLabel = userConfig.locationLabel || endpoints.locationLabel || state.locationLabel;
      state.timeZone = configuredTimeZone || endpoints.timeZone || state.timeZone;
      writeStorage(CONFIG.endpointCacheKey, endpoints);
      return endpoints;
    } catch (error) {
      if (cached?.forecast && cached?.hourly) {
        console.warn(`[${NAMESPACE}] Point lookup failed; using cached grid metadata.`, error);
        state.locationLabel = userConfig.locationLabel || cached.locationLabel || state.locationLabel;
        state.timeZone = configuredTimeZone || validTimeZone(cached.timeZone) || state.timeZone;
        return cached;
      }

      throw error;
    }
  }

  function scheduleRefresh(delay) {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(refresh, delay);
  }

  async function refresh() {
    try {
      const endpoints = await resolveEndpoints();
      const [forecast, hourly] = await Promise.all([
        fetchJson(withUnits(endpoints.forecast)),
        fetchJson(withUnits(endpoints.hourly)),
      ]);
      const data = normalize(forecast, hourly);

      state.data = data;
      writeStorage(CONFIG.weatherCacheKey, data);
      ensureMounted();
      render(data);
      scheduleRefresh(CONFIG.refreshMs);
    } catch (error) {
      console.warn(`[${NAMESPACE}] Refresh failed; keeping cached data.`, error);

      if (state.data) {
        render(state.data, true);
      } else {
        const root = document.getElementById(NAMESPACE);
        root?.setAttribute("aria-label", `${state.locationLabel} weather forecast unavailable`);
        root?.setAttribute("title", "The NWS forecast could not be loaded.");
      }

      scheduleRefresh(CONFIG.retryMs);
    }
  }

  addStyles();
  state.data = readWeatherCache();

  const observer = new MutationObserver(() => ensureMounted());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  ensureMounted();

  if (state.data) {
    render(state.data, true);
  }

  refresh();

  console.info(`[${NAMESPACE}] v${VERSION} loaded.`);
})();
